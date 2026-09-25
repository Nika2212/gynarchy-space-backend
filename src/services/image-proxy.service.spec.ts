import { BadRequestException, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { PassThrough } from 'stream';
import { XMDCentre } from '../core/centres/XMD.centre';
import { encryptURLToShortToken } from '../shared/url-token';
import { ImageProxyService } from './image-proxy.service';

jest.mock('axios');

const mockedAxios = axios as jest.MockedFunction<typeof axios>;

function mockResponse() {
  const res = {
    status: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    send: jest.fn(),
  };
  return res;
}

describe('ImageProxyService', () => {
  const xmdCentre = { isAllowedAssetURL: jest.fn().mockReturnValue(true) };
  const service = new ImageProxyService(xmdCentre as unknown as XMDCentre);
  const publicURL = 'https://cdn.example.com/a.jpg';
  const id = encryptURLToShortToken(publicURL);

  beforeEach(() => {
    mockedAxios.mockReset();
    xmdCentre.isAllowedAssetURL.mockReturnValue(true);
  });

  it('rejects a missing or invalid image id', async () => {
    await expect(service.proxy('', mockResponse() as never)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.proxy('nope', mockResponse() as never)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a private or disallowed host', async () => {
    const localID = encryptURLToShortToken('https://127.0.0.1/a.jpg');
    await expect(service.proxy(localID, mockResponse() as never)).rejects.toBeInstanceOf(BadRequestException);

    xmdCentre.isAllowedAssetURL.mockReturnValue(false);
    await expect(service.proxy(id, mockResponse() as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('pipes an allowed image and rejects a bad content type', async () => {
    const remote = new PassThrough();
    remote.destroy = jest.fn();
    mockedAxios.mockResolvedValue({
      data: remote,
      headers: { 'content-type': 'image/jpeg' },
    });

    const res = mockResponse();
    await service.proxy(id, res as never);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ 'Content-Type': 'image/jpeg' }));

    mockedAxios.mockResolvedValue({
      data: remote,
      headers: { 'content-type': 'text/html' },
    });
    await expect(service.proxy(id, mockResponse() as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(remote.destroy).toHaveBeenCalled();
  });

  it('returns 502 when the remote fetch fails', async () => {
    mockedAxios.mockRejectedValue(new Error('down'));
    const res = mockResponse();
    await service.proxy(id, res as never);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.send).toHaveBeenCalledWith('Error fetching remote image');
  });
});
