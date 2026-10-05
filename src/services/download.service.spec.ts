import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import axios, { AxiosError, type AxiosResponse } from 'axios';
import { firstValueFrom, filter } from 'rxjs';
import { Readable } from 'stream';
import type { BaseCentre } from '../core/centres/base.centre';
import { CentreRegistry } from '../core/centres/centre.registry';
import type { MediaRepository } from '../repositories/media.repository';
import type { IDownloadEvent } from '../shared/interfaces/download-event.interface';
import type { IDownloadJob } from '../shared/interfaces/download.interface';
import { encryptURLToShortToken } from '../shared/url-token';
import { DownloadService } from './download.service';
import type { StorageService } from './storage.service';

const PART_SIZE = 16 * 1024 * 1024;
const TOTAL = PART_SIZE + 1024;
const MEDIA = { title: 'Card', duration: 1, postedAt: '', thumbnailSrc: [] };
const ORIGIN = 'https://site.test/videos/1/';
const ID = encryptURLToShortToken(ORIGIN);

function ranged(status: number, body: Buffer, headers: Record<string, string> = {}): AxiosResponse {
  return { status, data: Readable.from([body]), headers: { 'content-type': 'video/mp4', ...headers } } as unknown as AxiosResponse;
}

function sourceError(status?: number): AxiosError {
  return new AxiosError('source', status ? 'ERR_BAD_RESPONSE' : 'ECONNRESET', undefined, undefined, status ? ({ status } as AxiosResponse) : undefined);
}

function rangeOf(config: { headers?: Record<string, string> }): [number, number] {
  const [start, end] = (config.headers?.Range ?? '').replace('bytes=', '').split('-').map(Number);
  return [start, end];
}

describe('DownloadService', () => {
  let centre: { getURL: jest.Mock; forget: jest.Mock; isAllowedAssetURL: jest.Mock };
  let repository: { findDownloadSize: jest.Mock; markDownloaded: jest.Mock; clearDownloaded: jest.Mock };
  let storage: Record<string, jest.Mock>;
  let get: jest.SpyInstance;
  let service: DownloadService;

  function serveSource(): void {
    get.mockImplementation(async (_url: string, config: { headers?: Record<string, string> }) => {
      const [start, end] = rangeOf(config);
      if (start === 0 && end === 0) {
        return ranged(206, Buffer.alloc(1), { 'content-range': `bytes 0-0/${TOTAL}` });
      }
      return ranged(206, Buffer.alloc(end - start + 1));
    });
  }

  function settled(): Promise<IDownloadJob> {
    return firstValueFrom(
      service.events$.pipe(filter((event: IDownloadEvent): boolean => event.type === 'job' && ['completed', 'failed', 'canceled'].includes(event.job.state))),
    ).then((event) => (event as { job: IDownloadJob }).job);
  }

  beforeEach(() => {
    centre = {
      getURL: jest.fn().mockResolvedValue('https://cdn.site.test/v.mp4'),
      forget: jest.fn(),
      isAllowedAssetURL: jest.fn((url: string) => url.startsWith('https://site.test')),
    };
    repository = {
      findDownloadSize: jest.fn().mockResolvedValue(null),
      markDownloaded: jest.fn().mockResolvedValue({ identifier: ID, isDownloaded: true }),
      clearDownloaded: jest.fn().mockResolvedValue({ identifier: ID, isDownloaded: false }),
    };
    storage = {
      isConfigured: jest.fn().mockReturnValue(true),
      usage: jest.fn().mockReturnValue({ isConfigured: true, usedBytes: 0, limitBytes: 10 * TOTAL, freeBytes: 10 * TOTAL }),
      keyFor: jest.fn().mockReturnValue('media/key.mp4'),
      createUpload: jest.fn().mockResolvedValue('upload-1'),
      uploadPart: jest.fn().mockImplementation(async (_key, _id, partNumber: number) => ({ ETag: `e${partNumber}`, PartNumber: partNumber })),
      completeUpload: jest.fn().mockResolvedValue(undefined),
      abortUpload: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      signedURL: jest.fn().mockResolvedValue('https://s3.test/signed'),
    };
    get = jest.spyOn(axios, 'get');
    jest.spyOn(DownloadService.prototype as never, 'sleep').mockResolvedValue(undefined as never);
    service = new DownloadService(
      new CentreRegistry([centre as unknown as BaseCentre]),
      repository as unknown as MediaRepository,
      storage as unknown as StorageService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('copies the video to storage part by part and marks it downloaded', async () => {
    serveSource();
    const done = settled();

    await expect(service.start(ID, MEDIA)).resolves.toMatchObject({ identifier: ID, state: 'queued', title: 'Card' });
    const job = await done;

    expect(job).toMatchObject({ state: 'completed', receivedBytes: TOTAL, totalBytes: TOTAL });
    expect(storage.uploadPart).toHaveBeenCalledTimes(2);
    expect((storage.uploadPart.mock.calls[0][3] as Buffer).length).toBe(PART_SIZE);
    expect((storage.uploadPart.mock.calls[1][3] as Buffer).length).toBe(1024);
    expect(storage.completeUpload).toHaveBeenCalledWith('media/key.mp4', 'upload-1', [{ ETag: 'e1', PartNumber: 1 }, { ETag: 'e2', PartNumber: 2 }], TOTAL);
    expect(repository.markDownloaded).toHaveBeenCalledWith(ID, MEDIA, TOTAL);
  });

  it('retries a dropped part and reports the attempt number', async () => {
    serveSource();
    const original = get.getMockImplementation()!;
    get.mockImplementationOnce(original).mockRejectedValueOnce(sourceError());
    const attempts: number[] = [];
    service.events$.subscribe((event) => event.type === 'job' && attempts.push(event.job.attempt));
    const done = settled();

    await service.start(ID, MEDIA);

    await expect(done).resolves.toMatchObject({ state: 'completed' });
    expect(attempts).toContain(2);
    expect(centre.forget).not.toHaveBeenCalled();
  });

  it('re-resolves the source link when the source rejects it', async () => {
    serveSource();
    const original = get.getMockImplementation()!;
    get.mockImplementationOnce(original).mockRejectedValueOnce(sourceError(403));
    const done = settled();

    await service.start(ID, MEDIA);

    await expect(done).resolves.toMatchObject({ state: 'completed' });
    expect(centre.forget).toHaveBeenCalledWith(ORIGIN);
    expect(centre.getURL).toHaveBeenCalledTimes(2);
  });

  it('gives up after five attempts, aborts the upload, and keeps the job as failed', async () => {
    serveSource();
    const original = get.getMockImplementation()!;
    get.mockImplementationOnce(original).mockRejectedValue(sourceError(503));
    const done = settled();

    await service.start(ID, MEDIA);
    const job = await done;

    expect(job).toMatchObject({ state: 'failed', attempt: 5, error: 'Source answered 503' });
    expect(storage.abortUpload).toHaveBeenCalledWith('media/key.mp4', 'upload-1');
    expect(service.snapshot().jobs).toHaveLength(1);
    expect(repository.markDownloaded).not.toHaveBeenCalled();
  });

  it('fails at once when the source cannot serve byte ranges', async () => {
    get.mockResolvedValue(ranged(200, Buffer.alloc(1)));
    const done = settled();

    await service.start(ID, MEDIA);

    await expect(done).resolves.toMatchObject({ state: 'failed', attempt: 1, error: 'Source does not support partial downloads' });
    expect(storage.createUpload).not.toHaveBeenCalled();
  });

  it('fails when the video does not fit in the free space', async () => {
    serveSource();
    storage.usage.mockReturnValue({ isConfigured: true, usedBytes: 0, limitBytes: 10, freeBytes: 10 });
    const done = settled();

    await service.start(ID, MEDIA);

    await expect(done).resolves.toMatchObject({ state: 'failed', error: expect.stringContaining('Not enough storage') });
    expect(storage.createUpload).not.toHaveBeenCalled();
  });

  it('cancels a running download and drops it from the list', async () => {
    let release: () => void = () => undefined;
    get.mockImplementation(() => new Promise((_resolve, reject) => (release = () => reject(new AxiosError('canceled', 'ERR_CANCELED')))));
    const done = settled();

    await service.start(ID, MEDIA);
    await new Promise((resolve) => setImmediate(resolve));
    await expect(service.remove(ID)).resolves.toBeNull();
    release();

    await expect(done).resolves.toMatchObject({ state: 'canceled' });
    expect(service.snapshot().jobs).toHaveLength(0);
  });

  it('retries a failed download with the card it saved', async () => {
    get.mockResolvedValue(ranged(200, Buffer.alloc(1)));
    const failed = settled();
    await service.start(ID, MEDIA);
    await failed;

    serveSource();
    const done = settled();
    await service.start(ID);

    await expect(done).resolves.toMatchObject({ state: 'completed' });
    expect(repository.markDownloaded).toHaveBeenCalledWith(ID, MEDIA, TOTAL);
  });

  it('runs at most three downloads at once and starts the next when a slot frees', async () => {
    const pending: Array<() => void> = [];
    get.mockImplementation(() => new Promise((_resolve, reject) => pending.push(() => reject(new AxiosError('canceled', 'ERR_CANCELED')))));
    const ids = [1, 2, 3, 4].map((n) => encryptURLToShortToken(`https://site.test/videos/${n}/`));

    for (const id of ids) {
      await service.start(id, MEDIA);
    }
    await new Promise((resolve) => setImmediate(resolve));

    const states = (): string[] => service.snapshot().jobs.map((job) => job.state);
    expect(states()).toEqual(['downloading', 'downloading', 'downloading', 'queued']);

    const canceled = settled();
    await service.remove(ids[0]);
    pending.shift()!();
    await canceled;
    await new Promise((resolve) => setImmediate(resolve));

    expect(states()).toEqual(['downloading', 'downloading', 'downloading']);
    for (const id of ids.slice(1)) {
      await service.remove(id);
    }
    pending.forEach((reject) => reject());
  });

  it('reserves space for running downloads so parallel ones cannot overfill storage', async () => {
    serveSource();
    storage.usage.mockReturnValue({ isConfigured: true, usedBytes: 0, limitBytes: TOTAL + 10, freeBytes: TOTAL + 10 });
    const original = get.getMockImplementation()!;
    let hold: () => void = () => undefined;
    get.mockImplementation(async (url: string, config: { headers?: Record<string, string> }) => {
      const [start, end] = rangeOf(config);
      if (start === 0 && end > 0) {
        await new Promise<void>((resolve) => (hold = resolve));
      }
      return original(url, config);
    });
    const second = encryptURLToShortToken('https://site.test/videos/2/');
    const failed = firstValueFrom(service.events$.pipe(filter((event: IDownloadEvent): boolean => event.type === 'job' && event.job.identifier === second && event.job.state === 'failed')));

    await service.start(ID, MEDIA);
    await new Promise((resolve) => setImmediate(resolve));
    await service.start(second, MEDIA);

    await expect(failed).resolves.toMatchObject({ job: { error: expect.stringContaining('Not enough storage') } });
    hold();
  });

  it('validates the request before queueing', async () => {
    await expect(service.start('nope', MEDIA)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.start(encryptURLToShortToken('https://other.test/v'), MEDIA)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.start(ID)).rejects.toBeInstanceOf(BadRequestException);

    repository.findDownloadSize.mockResolvedValueOnce(100);
    await expect(service.start(ID, MEDIA)).rejects.toBeInstanceOf(ConflictException);

    storage.isConfigured.mockReturnValue(false);
    await expect(service.start(ID, MEDIA)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('deletes a stored copy and clears the flag', async () => {
    repository.findDownloadSize.mockResolvedValue(TOTAL);

    await expect(service.remove(ID)).resolves.toEqual({ identifier: ID, isDownloaded: false });
    expect(storage.delete).toHaveBeenCalledWith('media/key.mp4', TOTAL);
    expect(repository.clearDownloaded).toHaveBeenCalledWith(ID);
  });

  it('gives a signed link only for downloaded media', async () => {
    await expect(service.playbackURL(ID)).resolves.toBeNull();

    repository.findDownloadSize.mockResolvedValue(TOTAL);
    await expect(service.playbackURL(ID)).resolves.toBe('https://s3.test/signed');
  });
});
