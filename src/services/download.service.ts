import { type CompletedPart } from '@aws-sdk/client-s3';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';
import { Readable } from 'stream';
import { Observable, Subject } from 'rxjs';
import { BaseCentre } from '../core/centres/base.centre';
import { CentreRegistry } from '../core/centres/centre.registry';
import { MediaFlags, MediaRepository } from '../repositories/media.repository';
import { isPublicHTTPHost } from '../shared/image-type';
import { IDownloadEvent } from '../shared/interfaces/download-event.interface';
import { IDownloadJob, IDownloadSnapshot } from '../shared/interfaces/download.interface';
import { IMediaSnapshot } from '../shared/interfaces/media-snapshot.interface';
import { decryptShortTokenToURL } from '../shared/url-token';
import { StorageService } from './storage.service';

// B2 needs parts of at least 5 MB; 16 MB keeps a 1 GB video near 64 parts and one part per download in memory.
const PART_SIZE = 16 * 1024 * 1024;
// Up to three videos copy at once (about 48 MB of parts in memory); the rest wait in the queue.
const MAX_CONCURRENT = 3;
const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;
// A source that sends nothing for this long is treated as dropped and the part is retried.
const STALL_TIMEOUT_MS = 30_000;
const PROGRESS_EMIT_MS = 500;
const COMPLETED_JOB_TTL_MS = 30_000;
// Statuses that usually mean the signed source link expired, so the next attempt resolves a fresh one.
const REFRESH_STATUSES = new Set([401, 403, 404, 410]);

class DownloadError extends Error {
  // A failure with a hint for the retry loop: whether to try again and whether the source link should be re-resolved.
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly refresh = false,
  ) {
    super(message);
  }
}

class DownloadCanceledError extends Error {
  constructor() {
    super('Download canceled');
  }
}

interface IDownloadTask {
  job: IDownloadJob;
  media: IMediaSnapshot;
  originURL: string;
  centre: BaseCentre;
  abort: AbortController;
  videoURL: string | null;
  lastEmitAt: number;
}

@Injectable()
export class DownloadService implements OnModuleDestroy {
  private readonly logger = new Logger(DownloadService.name);
  private readonly tasks = new Map<string, IDownloadTask>();
  private readonly queue: IDownloadTask[] = [];
  private readonly eventsSubject = new Subject<IDownloadEvent>();
  private running = 0;
  private reservedBytes = 0;

  public readonly events$: Observable<IDownloadEvent> = this.eventsSubject.asObservable();

  constructor(
    private readonly centreRegistry: CentreRegistry,
    private readonly mediaRepository: MediaRepository,
    private readonly storage: StorageService,
  ) {}

  // Stops every running download when the app shuts down; their multipart uploads are aborted on the next start.
  public onModuleDestroy(): void {
    this.tasks.forEach((task) => task.abort.abort());
  }

  public snapshot(): IDownloadSnapshot {
    return {
      jobs: [...this.tasks.values()].map((task) => ({ ...task.job })),
      storage: this.storage.usage(),
    };
  }

  // Queues one media for download. Starting an active download returns it as is; a failed one is retried with its saved card.
  public async start(identifier: string, media?: IMediaSnapshot): Promise<IDownloadJob> {
    if (!this.storage.isConfigured()) {
      throw new ServiceUnavailableException('Storage is not configured');
    }

    const originURL = identifier ? decryptShortTokenToURL(identifier) : null;
    const centre = originURL ? this.centreRegistry.findByURL(originURL) : undefined;
    if (!originURL || !centre) {
      throw new NotFoundException('Invalid media id');
    }

    const existing = this.tasks.get(identifier);
    if (existing && (existing.job.state === 'queued' || existing.job.state === 'downloading')) {
      return { ...existing.job };
    }

    if ((await this.mediaRepository.findDownloadSize(identifier)) !== null) {
      throw new ConflictException('Media is already downloaded');
    }

    const card = media ?? existing?.media;
    if (!card) {
      throw new BadRequestException('Media card is required');
    }

    const task: IDownloadTask = {
      job: {
        identifier,
        title: card.title,
        state: 'queued',
        receivedBytes: 0,
        totalBytes: 0,
        attempt: 0,
        maxAttempts: MAX_ATTEMPTS,
        error: null,
        updatedAt: new Date(),
      },
      media: card,
      originURL,
      centre,
      abort: new AbortController(),
      videoURL: null,
      lastEmitAt: 0,
    };

    this.tasks.set(identifier, task);
    this.queue.push(task);
    this.emitJob(task, true);
    const queued = { ...task.job };
    this.pump();

    return queued;
  }

  // Cancels an active download, dismisses a finished one, or deletes the stored copy. Returns the new flags when a row exists.
  public async remove(identifier: string): Promise<MediaFlags | null> {
    const task = this.tasks.get(identifier);

    if (task && (task.job.state === 'queued' || task.job.state === 'downloading')) {
      task.abort.abort();
      if (task.job.state === 'queued') {
        this.dropQueued(task);
      }
      return null;
    }

    if (task) {
      this.forgetTask(identifier);
    }

    const size = await this.mediaRepository.findDownloadSize(identifier);
    if (size === null) {
      return null;
    }

    await this.storage.delete(this.storage.keyFor(identifier), size);
    const flags = await this.mediaRepository.clearDownloaded(identifier);
    this.emitStorage();
    return flags;
  }

  // Signed B2 link for a downloaded media, or null when it is not stored.
  public async playbackURL(identifier: string): Promise<string | null> {
    if (!this.storage.isConfigured() || (await this.mediaRepository.findDownloadSize(identifier)) === null) {
      return null;
    }
    return this.storage.signedURL(this.storage.keyFor(identifier));
  }

  // Starts queued downloads until MAX_CONCURRENT are running; each finished one frees a slot for the next.
  private pump(): void {
    while (this.running < MAX_CONCURRENT && this.queue.length > 0) {
      const task = this.queue.shift()!;
      if (task.abort.signal.aborted) {
        continue;
      }

      this.running += 1;
      void this.run(task).finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
  }

  private async run(task: IDownloadTask): Promise<void> {
    const { job } = task;
    const key = this.storage.keyFor(job.identifier);
    let uploadId: string | null = null;
    let reserved = 0;

    try {
      this.update(task, { state: 'downloading', attempt: 1, error: null }, true);

      const totalBytes = await this.withRetry(task, async (refresh) => this.probeSize(task, refresh));
      const free = this.storage.usage().freeBytes - this.reservedBytes;
      if (totalBytes > free) {
        throw new DownloadError(`Not enough storage: needs ${this.toMB(totalBytes)} MB, ${this.toMB(Math.max(0, free))} MB free`, false);
      }
      this.reservedBytes += totalBytes;
      reserved = totalBytes;
      this.update(task, { totalBytes }, true);

      uploadId = await this.withRetry(task, async () => this.storage.createUpload(key));
      const parts: CompletedPart[] = [];

      for (let start = 0, partNumber = 1; start < totalBytes; start += PART_SIZE, partNumber += 1) {
        const end = Math.min(start + PART_SIZE, totalBytes) - 1;
        const body = await this.withRetry(task, async (refresh) => this.fetchPart(task, start, end, refresh));
        parts.push(await this.withRetry(task, async () => this.storage.uploadPart(key, uploadId!, partNumber, body)));
        this.update(task, { receivedBytes: end + 1, attempt: 1 });
      }

      await this.withRetry(task, async () => this.storage.completeUpload(key, uploadId!, parts, totalBytes));
      uploadId = null;
      this.reservedBytes -= reserved;
      reserved = 0;
      await this.withRetry(task, async () => this.mediaRepository.markDownloaded(job.identifier, task.media, totalBytes));

      this.update(task, { state: 'completed', receivedBytes: totalBytes }, true);
      this.emitStorage();
      setTimeout(() => this.forgetTask(job.identifier, 'completed'), COMPLETED_JOB_TTL_MS).unref();
    } catch (error) {
      if (uploadId) {
        await this.storage.abortUpload(key, uploadId);
      }

      if (error instanceof DownloadCanceledError || task.abort.signal.aborted) {
        this.update(task, { state: 'canceled' }, true);
        this.forgetTask(job.identifier);
        return;
      }

      const message = (error as Error)?.message || 'Download failed';
      this.logger.error(`Download ${job.identifier} failed: ${message}`);
      this.update(task, { state: 'failed', error: message }, true);
    } finally {
      this.reservedBytes -= reserved;
    }
  }

  // Runs one step, retrying transient failures with exponential backoff. The attempt number is shown to the client.
  private async withRetry<T>(task: IDownloadTask, work: (refresh: boolean) => Promise<T>): Promise<T> {
    let refresh = false;

    for (let attempt = 1; ; attempt += 1) {
      this.throwIfCanceled(task);
      if (attempt > 1) {
        this.update(task, { attempt }, true);
      }

      try {
        return await work(refresh);
      } catch (error) {
        if (error instanceof DownloadCanceledError || task.abort.signal.aborted) {
          throw new DownloadCanceledError();
        }

        const classified = this.classify(error);
        if (!classified.retryable || attempt >= MAX_ATTEMPTS) {
          throw classified;
        }

        refresh = classified.refresh;
        this.logger.warn(`Download ${task.job.identifier} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${classified.message}`);
        await this.sleep(Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS), task.abort.signal);
      }
    }
  }

  // Asks the source for one byte to learn the full size and confirm it serves byte ranges.
  private async probeSize(task: IDownloadTask, refresh: boolean): Promise<number> {
    const url = await this.videoURL(task, refresh);
    const response = await axios.get(url, {
      headers: { Range: 'bytes=0-0' },
      responseType: 'stream',
      timeout: STALL_TIMEOUT_MS,
      signal: task.abort.signal,
      validateStatus: (status) => status === HttpStatus.OK || status === HttpStatus.PARTIAL_CONTENT,
    });
    (response.data as Readable).destroy();

    this.assertVideo(response.headers['content-type']);

    if (response.status !== HttpStatus.PARTIAL_CONTENT) {
      throw new DownloadError('Source does not support partial downloads', false);
    }

    const total = Number(String(response.headers['content-range'] ?? '').split('/')[1]);
    if (!Number.isFinite(total) || total <= 0) {
      throw new DownloadError('Source did not report the video size', true, true);
    }
    return total;
  }

  // Downloads one byte range, counting bytes as they arrive and treating a silent connection as a dropped one.
  private async fetchPart(task: IDownloadTask, start: number, end: number, refresh: boolean): Promise<Buffer> {
    const url = await this.videoURL(task, refresh);
    const stall = new AbortController();
    const signal = AbortSignal.any([task.abort.signal, stall.signal]);
    let timer = setTimeout(() => stall.abort(), STALL_TIMEOUT_MS);
    const resetStall = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => stall.abort(), STALL_TIMEOUT_MS);
    };

    const chunks: Buffer[] = [];
    let received = 0;

    try {
      const response = await axios.get(url, {
        headers: { Range: `bytes=${start}-${end}` },
        responseType: 'stream',
        timeout: STALL_TIMEOUT_MS,
        signal,
        validateStatus: (status) => status === HttpStatus.PARTIAL_CONTENT,
      });

      for await (const chunk of response.data as Readable) {
        const buffer = chunk as Buffer;
        chunks.push(buffer);
        received += buffer.length;
        resetStall();
        this.update(task, { receivedBytes: start + received });
      }
    } catch (error) {
      this.update(task, { receivedBytes: start });
      if (stall.signal.aborted && !task.abort.signal.aborted) {
        throw new DownloadError('Source stopped sending data', true);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    if (received !== end - start + 1) {
      this.update(task, { receivedBytes: start });
      throw new DownloadError(`Source sent ${received} of ${end - start + 1} bytes`, true);
    }
    return Buffer.concat(chunks, received);
  }

  // Resolves the playable source URL through the centre, re-resolving it when the previous one was rejected.
  private async videoURL(task: IDownloadTask, refresh: boolean): Promise<string> {
    if (refresh || !task.videoURL) {
      if (refresh) {
        task.centre.forget(task.originURL);
      }
      task.videoURL = await task.centre.getURL(task.originURL);
    }

    let host: string;
    try {
      host = new URL(task.videoURL).hostname;
    } catch {
      throw new DownloadError('Source returned an invalid video URL', true, true);
    }
    if (!isPublicHTTPHost(host)) {
      throw new DownloadError('Source video URL points at a private host', false);
    }
    return task.videoURL;
  }

  private assertVideo(contentType: unknown): void {
    const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
    if (!type.startsWith('video/') && type !== 'application/octet-stream') {
      throw new DownloadError(`Source returned ${type || 'an unknown type'} instead of a video`, true, true);
    }
  }

  // Sorts failures into "try again", "try again with a fresh link", and "give up".
  private classify(error: unknown): DownloadError {
    if (error instanceof DownloadError) {
      return error;
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status === undefined) {
        return new DownloadError(`Source connection failed: ${error.code ?? error.message}`, true);
      }
      if (REFRESH_STATUSES.has(status)) {
        return new DownloadError(`Source answered ${status}`, true, true);
      }
      return new DownloadError(`Source answered ${status}`, status === 408 || status === 425 || status === 429 || status >= 500);
    }

    if (error instanceof HttpException) {
      const status = error.getStatus();
      return new DownloadError(error.message, status === 429 || status >= 500);
    }

    const storageStatus = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    if (storageStatus !== undefined) {
      return new DownloadError(`Storage answered ${storageStatus}`, storageStatus === 408 || storageStatus === 429 || storageStatus >= 500);
    }

    return new DownloadError((error as Error)?.message || 'Unexpected download error', true);
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new DownloadCanceledError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private throwIfCanceled(task: IDownloadTask): void {
    if (task.abort.signal.aborted) {
      throw new DownloadCanceledError();
    }
  }

  private dropQueued(task: IDownloadTask): void {
    const index = this.queue.indexOf(task);
    if (index >= 0) {
      this.queue.splice(index, 1);
    }
    this.update(task, { state: 'canceled' }, true);
    this.forgetTask(task.job.identifier);
  }

  // Removes a job from the list. With a state, only removes it if it is still in that state (a retry may have replaced it).
  private forgetTask(identifier: string, onlyIfState?: IDownloadJob['state']): void {
    const task = this.tasks.get(identifier);
    if (!task || (onlyIfState && task.job.state !== onlyIfState)) {
      return;
    }
    this.tasks.delete(identifier);
    this.eventsSubject.next({ type: 'removed', identifier });
  }

  private update(task: IDownloadTask, changes: Partial<IDownloadJob>, force = false): void {
    Object.assign(task.job, changes, { updatedAt: new Date() });
    this.emitJob(task, force);
  }

  // State changes go out at once; byte progress is throttled so a fast download does not flood the socket.
  private emitJob(task: IDownloadTask, force: boolean): void {
    const now = Date.now();
    if (!force && now - task.lastEmitAt < PROGRESS_EMIT_MS) {
      return;
    }
    task.lastEmitAt = now;
    this.eventsSubject.next({ type: 'job', job: { ...task.job } });
  }

  private emitStorage(): void {
    this.eventsSubject.next({ type: 'storage', storage: this.storage.usage() });
  }

  private toMB(bytes: number): string {
    return (bytes / 1024 / 1024).toFixed(1);
  }
}
