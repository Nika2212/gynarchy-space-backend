import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  S3Client,
  UploadPartCommand,
  type CompletedPart,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { hashIdentifier } from '../shared/identifier-hash';
import { IStorageUsage } from '../shared/interfaces/download.interface';

const KEY_PREFIX = 'media/';
const DEFAULT_LIMIT_GB = 512;
const BYTES_PER_GB = 1024 ** 3;
// Long enough to watch a full video and seek around without the link expiring mid-play.
const SIGNED_URL_TTL_SECONDS = 6 * 60 * 60;
const READ_CHECK_TIMEOUT_MS = 5_000;

interface IStorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  keyId: string;
  applicationKey: string;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly config: IStorageConfig | null;
  private readonly client: S3Client | null;
  private readonly limitBytes: number;
  private usedBytes = 0;

  // Reads the Backblaze B2 (S3 API) settings. Downloads stay disabled until every B2_* variable is set.
  constructor(private readonly configService: ConfigService) {
    this.config = this.readConfig();
    this.limitBytes = this.readLimitGB() * BYTES_PER_GB;
    this.client = this.config
      ? new S3Client({
          endpoint: this.config.endpoint,
          region: this.config.region,
          credentials: { accessKeyId: this.config.keyId, secretAccessKey: this.config.applicationKey },
        })
      : null;
  }

  // Measures what is already stored and aborts multipart uploads left behind by a restart.
  public async onModuleInit(): Promise<void> {
    if (!this.client) {
      this.logger.warn('Storage is not configured; downloads are disabled until B2_* variables are set');
      return;
    }

    try {
      await this.abortOrphanedUploads();
      this.usedBytes = await this.measureUsedBytes();
      this.logger.log(`Storage ready: ${(this.usedBytes / BYTES_PER_GB).toFixed(2)} GB used`);
    } catch (error) {
      this.logger.error(`Storage init failed: ${(error as Error)?.message ?? 'unknown error'}`);
    }
  }

  public isConfigured(): boolean {
    return this.client !== null;
  }

  public usage(): IStorageUsage {
    return {
      isConfigured: this.isConfigured(),
      usedBytes: this.usedBytes,
      limitBytes: this.limitBytes,
      freeBytes: Math.max(0, this.limitBytes - this.usedBytes),
    };
  }

  // Object key for a media id. It is an HMAC of the id, so the bucket listing reveals nothing about the video.
  public keyFor(identifier: string): string {
    return `${KEY_PREFIX}${hashIdentifier(identifier, this.configService.getOrThrow<string>('JWT_SECRET'))}.mp4`;
  }

  public async createUpload(key: string): Promise<string> {
    const { UploadId } = await this.s3().send(new CreateMultipartUploadCommand({ Bucket: this.bucket(), Key: key, ContentType: 'video/mp4' }));
    if (!UploadId) {
      throw new Error('Storage did not return an upload id');
    }
    return UploadId;
  }

  public async uploadPart(key: string, uploadId: string, partNumber: number, body: Buffer): Promise<CompletedPart> {
    const { ETag } = await this.s3().send(
      new UploadPartCommand({ Bucket: this.bucket(), Key: key, UploadId: uploadId, PartNumber: partNumber, Body: body, ContentLength: body.length }),
    );
    return { ETag, PartNumber: partNumber };
  }

  public async completeUpload(key: string, uploadId: string, parts: CompletedPart[], sizeBytes: number): Promise<void> {
    await this.s3().send(new CompleteMultipartUploadCommand({ Bucket: this.bucket(), Key: key, UploadId: uploadId, MultipartUpload: { Parts: parts } }));
    this.usedBytes += sizeBytes;
  }

  // Best effort: a failed abort only leaves parts that the next restart cleans up.
  public async abortUpload(key: string, uploadId: string): Promise<void> {
    try {
      await this.s3().send(new AbortMultipartUploadCommand({ Bucket: this.bucket(), Key: key, UploadId: uploadId }));
    } catch (error) {
      this.logger.warn(`Abort upload failed: ${(error as Error)?.message ?? 'unknown error'}`);
    }
  }

  public async delete(key: string, sizeBytes: number): Promise<void> {
    await this.s3().send(new DeleteObjectCommand({ Bucket: this.bucket(), Key: key }));
    this.usedBytes = Math.max(0, this.usedBytes - sizeBytes);
  }

  // Reads the first byte of a signed link to learn whether B2 serves it right now. B2 refuses downloads once the daily download
  // cap is reached (403 download_cap_exceeded); a refused or unreachable link means the player should stream from the source.
  public async isReadable(signedURL: string): Promise<boolean> {
    try {
      const response = await axios.get<string>(signedURL, {
        headers: { Range: 'bytes=0-0' },
        responseType: 'text',
        timeout: READ_CHECK_TIMEOUT_MS,
        validateStatus: () => true,
      });
      if (response.status === 200 || response.status === 206) {
        return true;
      }
      this.logger.warn(`Storage refused a download (${response.status}): ${String(response.data).slice(0, 200)}`);
      return false;
    } catch (error) {
      this.logger.warn(`Storage could not be reached: ${(error as Error)?.message ?? 'unknown error'}`);
      return false;
    }
  }

  // Short-lived link the player fetches straight from B2, so playback never streams through this server.
  public async signedURL(key: string): Promise<string> {
    return getSignedUrl(this.s3(), new GetObjectCommand({ Bucket: this.bucket(), Key: key }), { expiresIn: SIGNED_URL_TTL_SECONDS });
  }

  private async abortOrphanedUploads(): Promise<void> {
    const { Uploads } = await this.s3().send(new ListMultipartUploadsCommand({ Bucket: this.bucket(), Prefix: KEY_PREFIX }));

    for (const upload of Uploads ?? []) {
      if (upload.Key && upload.UploadId) {
        await this.abortUpload(upload.Key, upload.UploadId);
      }
    }
  }

  private async measureUsedBytes(): Promise<number> {
    let total = 0;
    let token: string | undefined;

    do {
      const page = await this.s3().send(new ListObjectsV2Command({ Bucket: this.bucket(), Prefix: KEY_PREFIX, ContinuationToken: token }));
      total += (page.Contents ?? []).reduce((sum, object) => sum + (object.Size ?? 0), 0);
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);

    return total;
  }

  private s3(): S3Client {
    if (!this.client) {
      throw new ServiceUnavailableException('Storage is not configured');
    }
    return this.client;
  }

  private bucket(): string {
    return this.config!.bucket;
  }

  private readConfig(): IStorageConfig | null {
    const read = (key: string): string => (this.configService.get<string>(key) ?? '').trim();
    const config = {
      endpoint: read('B2_ENDPOINT'),
      region: read('B2_REGION'),
      bucket: read('B2_BUCKET'),
      keyId: read('B2_KEY_ID'),
      applicationKey: read('B2_APPLICATION_KEY'),
    };

    return Object.values(config).every((value) => value.length > 0) ? config : null;
  }

  private readLimitGB(): number {
    const value = Number(this.configService.get<string>('STORAGE_LIMIT_GB'));
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_LIMIT_GB;
  }
}
