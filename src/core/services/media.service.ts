import { BadRequestException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { PER_PAGE_SIZE, XMDCentre } from '../../centres/XMD.centre';
import { IFindAll } from '../../interfaces/query.interface';
import { IMediaContainer } from '../../interfaces/media-container.interface';
import { IMediaInfo } from '../../interfaces/media-info.interface';
import { IMeta } from '../../interfaces/meta.interface';
import axios from 'axios';
import type { Response } from 'express';
import { isIP } from 'node:net';
import { decryptShortTokenToUrl } from '../helpers/utils';

@Injectable()
export class MediaService {
  constructor(private readonly xmdCentre: XMDCentre) {}

  public async findAll(query: IFindAll): Promise<IMediaContainer> {
    const medias: IMediaInfo[] = await this.xmdCentre.search(query.keyword, query.page);
    const meta: IMeta = {
      currentPage: query.page,
      isLastPage: medias.length < PER_PAGE_SIZE,
    };

    return {
      medias,
      meta,
    };
  }

  public async find(id: string, range: string, response: Response): Promise<void> {
    if (!id) {
      throw new NotFoundException('Invalid media id');
    }

    const decryptedURL: string = await this.xmdCentre.getUrl(decryptShortTokenToUrl(id) as string);
    try {
      const remoteResponse = await axios({
        method: 'GET',
        url: decryptedURL,
        responseType: 'stream',
        headers: range ? { Range: range } : {},
      });
      const status = range ? HttpStatus.PARTIAL_CONTENT : HttpStatus.OK;

      response.status(status).set({
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Range': remoteResponse.headers['content-range'],
        'Content-Length': remoteResponse.headers['content-length'],
      });

      remoteResponse.data.pipe(response);
    } catch (error) {
      response.status(HttpStatus.BAD_GATEWAY).send('Error fetching remote stream');
    }
  }

  public async findImage(id: string, response: Response): Promise<void> {
    if (!id) {
      throw new NotFoundException('Invalid image id');
    }

    const decryptedURL = decryptShortTokenToUrl(id);
    if (!decryptedURL) {
      throw new NotFoundException('Invalid image id');
    }

    this.assertPublicHttpUrl(decryptedURL);

    try {
      const remoteResponse = await axios({
        method: 'GET',
        url: decryptedURL,
        responseType: 'stream',
        timeout: 10_000,
      });

      response.status(HttpStatus.OK).set({
        'Content-Type': remoteResponse.headers['content-type'] ?? 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      });

      remoteResponse.data.pipe(response);
    } catch (error) {
      response.status(HttpStatus.BAD_GATEWAY).send('Error fetching remote image');
    }
  }

  private assertPublicHttpUrl(url: string): void {
    const { hostname } = new URL(url);
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

    if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') {
      throw new BadRequestException('Invalid image url');
    }

    if (isIP(host) && isPrivateIp(host)) {
      throw new BadRequestException('Invalid image url');
    }
  }
}

function isPrivateIp(host: string): boolean {
  if (host.includes(':')) {
    return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80');
  }

  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}
