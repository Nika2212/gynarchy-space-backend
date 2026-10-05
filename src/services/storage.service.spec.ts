import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import axios, { type AxiosResponse } from 'axios';
import { StorageService } from './storage.service';

describe('StorageService.isReadable', () => {
  const service = new StorageService({ get: () => undefined } as unknown as ConfigService);
  let get: jest.SpyInstance;

  beforeEach(() => {
    get = jest.spyOn(axios, 'get');
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads one byte of the signed link and reports whether storage serves it', async () => {
    get.mockResolvedValue({ status: 206, data: 'x' } as AxiosResponse);

    await expect(service.isReadable('https://s3.test/media/a.mp4?sig=1')).resolves.toBe(true);
    expect(get).toHaveBeenCalledWith('https://s3.test/media/a.mp4?sig=1', expect.objectContaining({ headers: { Range: 'bytes=0-0' } }));
  });

  it('reports a refused download, such as the daily download cap, as not readable', async () => {
    get.mockResolvedValue({ status: 403, data: '{"code":"download_cap_exceeded","status":403}' } as AxiosResponse);

    await expect(service.isReadable('https://s3.test/media/a.mp4?sig=1')).resolves.toBe(false);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('download_cap_exceeded'));
  });

  it('reports an unreachable storage as not readable', async () => {
    get.mockRejectedValue(new Error('timeout of 5000ms exceeded'));

    await expect(service.isReadable('https://s3.test/media/a.mp4?sig=1')).resolves.toBe(false);
  });
});
