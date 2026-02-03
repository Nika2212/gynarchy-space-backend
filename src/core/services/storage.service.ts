import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Console } from '../helpers/console';

@Injectable()
export class StorageService {
  private s3Client: S3Client;

  constructor(private readonly configService: ConfigService) {
    void this.onInit();
  }

  private async onInit(): Promise<void> {
    this.s3Client = new S3Client({
      region: this.configService.get<string>('WASABI_REGION') as string,
      endpoint: this.configService.get<string>('WASABI_ENDPOINT') as string,
      credentials: {
        accessKeyId: this.configService.get<string>('WASABI_ACCESS_KEY') as string,
        secretAccessKey: this.configService.get<string>('WASABI_SECRET_KEY') as string,
      },
      forcePathStyle: true,
    });

    try {
      await this.s3Client.send(
        new HeadBucketCommand({
          Bucket: this.configService.get('WASABI_BUCKET'),
        }),
      );
      Console.success('WASABI initialized successfully');
    } catch (error) {
      Console.error(`WASABI initialization error: ${error}`);
    }
  }
}