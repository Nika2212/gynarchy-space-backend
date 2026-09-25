import { BadRequestException, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { PassThrough } from 'stream';
import { XMDCentre } from '../core/centres/XMD.centre';
import { encryptURLToShortToken } from '../shared/url-token';
import { MediaStreamService } from './media-stream.service';

jest.mock('axios');

const mockedAxios = axios as jest.MockedFunction<typeof axios>;

function mockResponse(headersSent = false) {
  const res = new PassThrough() as PassThrough & {
    status: jest.Mock;
    set: jest.Mock;
    send: jest.Mock;
    headersSent: boolean;
  };
  res.status = jest.fn().mockReturnThis();
  res.set = jest.fn().mockReturnThis();
  res.send = jest.fn();
  res.headersSent = headersSent;
  return res;
}

describe('MediaStreamService', () => {
  const xmdCentre = { getURL: jest.fn().mockResolvedValue('https://cdn.example.com/v.mp4') };
  const service = new MediaStreamService(xmdCentre as unknown as XMDCentre);
  const originURL = 'https://xmegadrive.com/videos/1';
  const id = encryptURLToShortToken(originURL);

  beforeEach(() => {
    mockedAxios.mockReset();
    xmdCentre.getURL.mockResolvedValue('https://cdn.example.com/v.mp4');
  });

  it('rejects a missing or invalid media id', async () => {
    await expect(service.stream('', '', mockResponse() as never)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.stream('nope', '', mockResponse() as never)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('pipes a video stream and maps octet-stream to mp4', async () => {
    const remote = new PassThrough();
    mockedAxios.mockImplementation(async (config) => {
      expect(config.validateStatus?.(200)).toBe(true);
      expect(config.validateStatus?.(206)).toBe(true);
      expect(config.validateStatus?.(500)).toBe(false);
      return {
        status: 206,
        data: remote,
        headers: {
          'content-type': 'application/octet-stream',
          'content-range': 'bytes 0-1/2',
          'content-length': '2',
        },
      };
    });

    const res = mockResponse();
    await service.stream(id, 'bytes=0-1', res as never);
    expect(mockedAxios).toHaveBeenCalledWith(expect.objectContaining({ headers: { Range: 'bytes=0-1' } }));
    expect(res.status).toHaveBeenCalledWith(206);
    expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ 'Content-Type': 'video/mp4' }));
    remote.emit('end');
    remote.emit('error', new Error('pipe'));
  });

  it('omits Range when it is empty and rejects a non-video type', async () => {
    const remote = new PassThrough();
    remote.destroy = jest.fn();
    mockedAxios.mockResolvedValue({
      status: 200,
      data: remote,
      headers: { 'content-type': 'text/html' },
    });

    await expect(service.stream(id, '', mockResponse() as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(mockedAxios).toHaveBeenCalledWith(expect.objectContaining({ headers: {} }));
    expect(remote.destroy).toHaveBeenCalled();
  });

  it('rethrows known HTTP errors and sends 502 otherwise', async () => {
    xmdCentre.getURL.mockRejectedValueOnce(new NotFoundException('gone'));
    await expect(service.stream(id, '', mockResponse() as never)).rejects.toBeInstanceOf(NotFoundException);

    mockedAxios.mockRejectedValue(new Error('down'));
    const res = mockResponse();
    await service.stream(id, '', res as never);
    expect(res.status).toHaveBeenCalledWith(502);

    const sent = mockResponse(true);
    await service.stream(id, '', sent as never);
    expect(sent.status).not.toHaveBeenCalled();
  });

  it('aborts the remote fetch when the client closes', async () => {
    let capturedSignal: AbortSignal | undefined;
    mockedAxios.mockImplementation(async (config) => {
      capturedSignal = (config as { signal?: AbortSignal }).signal;
      await new Promise((resolve) => setImmediate(resolve));
      const remote = new PassThrough();
      return {
        status: 200,
        data: remote,
        headers: { 'content-type': 'video/mp4' },
      };
    });

    const res = mockResponse();
    const pending = service.stream(id, '', res as never);
    await new Promise((resolve) => setImmediate(resolve));
    res.emit('close');
    await pending;
    expect(capturedSignal?.aborted).toBe(true);
  });
});
