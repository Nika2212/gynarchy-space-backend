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
import { normalizeAllowedImageType } from '../helpers/image-proxy';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class MediaService {
  constructor(
    private readonly xmdCentre: XMDCentre,
    private readonly databaseService: DatabaseService,
  ) {}

  public async findAll(query: IFindAll): Promise<IMediaContainer> {
    const medias: IMediaInfo[] = await this.xmdCentre.search(query.keyword, query.page);
    await this.databaseService.upsertFromSearch(medias);
    const rows = await this.databaseService.findByIdentifiers(
      medias.map((media) => media.identifier).filter((id): id is string => Boolean(id)),
    );
    const byId = new Map(rows.map((row) => [row.identifier, row]));

    const meta: IMeta = {
      currentPage: query.page,
      isLastPage: medias.length < PER_PAGE_SIZE,
    };

    return {
      medias: medias.map((media) => {
        const row = media.identifier ? byId.get(media.identifier) : undefined;
        return {
          ...media,
          isLiked: row?.isLiked ?? false,
          isFavorite: row?.isFavorite ?? false,
          isHidden: row?.isHidden ?? false,
          watchedAt: row?.watchedAt ?? undefined,
          watchedTimes: row?.watchedTimes ?? 0,
          watchPositionAt: row?.watchPositionAt ?? undefined,
        };
      }),
      meta,
    };
  }

  public async toggleLike(id: string) {
    if (!id || !decryptShortTokenToUrl(id)) {
      throw new NotFoundException('Invalid media id');
    }
    return this.databaseService.toggleLike(id);
  }

  public async toggleFavorite(id: string) {
    if (!id || !decryptShortTokenToUrl(id)) {
      throw new NotFoundException('Invalid media id');
    }
    return this.databaseService.toggleFavorite(id);
  }

  public async toggleHidden(id: string) {
    if (!id || !decryptShortTokenToUrl(id)) {
      throw new NotFoundException('Invalid media id');
    }
    return this.databaseService.toggleHidden(id);
  }

  public async find(id: string, range: string, response: Response): Promise<void> {
    if (!id) {
      throw new NotFoundException('Invalid media id');
    }

    const originUrl = decryptShortTokenToUrl(id);
    if (!originUrl) {
      throw new NotFoundException('Invalid media id');
    }

    const decryptedURL = await this.xmdCentre.getUrl(originUrl);
    const abort = new AbortController();
    const onClose = (): void => abort.abort();
    response.once('close', onClose);

    try {
      const remoteResponse = await axios({
        method: 'GET',
        url: decryptedURL,
        responseType: 'stream',
        timeout: 15_000,
        signal: abort.signal,
        headers: range ? { Range: range } : {},
        validateStatus: (status) => status === HttpStatus.OK || status === HttpStatus.PARTIAL_CONTENT,
      });

      const contentType = String(remoteResponse.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (!contentType.startsWith('video/') && contentType !== 'application/octet-stream') {
        remoteResponse.data.destroy();
        throw new BadRequestException('Invalid media type');
      }

      const status =
        remoteResponse.status === HttpStatus.PARTIAL_CONTENT
          ? HttpStatus.PARTIAL_CONTENT
          : HttpStatus.OK;

      response.status(status).set({
        'Content-Type': contentType === 'application/octet-stream' ? 'video/mp4' : contentType,
        'Accept-Ranges': 'bytes',
        'Content-Range': remoteResponse.headers['content-range'],
        'Content-Length': remoteResponse.headers['content-length'],
      });

      remoteResponse.data.pipe(response);
      remoteResponse.data.once('end', () => response.off('close', onClose));
      remoteResponse.data.once('error', () => response.off('close', onClose));
    } catch (error) {
      response.off('close', onClose);
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      if (!response.headersSent) {
        response.status(HttpStatus.BAD_GATEWAY).send('Error fetching remote stream');
      }
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

    if (!this.xmdCentre.isAllowedAssetUrl(decryptedURL)) {
      throw new BadRequestException('Invalid image url');
    }

    try {
      const remoteResponse = await axios({
        method: 'GET',
        url: decryptedURL,
        responseType: 'stream',
        timeout: 10_000,
        maxRedirects: 0,
      });

      const contentType = normalizeAllowedImageType(remoteResponse.headers['content-type']);
      if (!contentType) {
        remoteResponse.data.destroy();
        throw new BadRequestException('Invalid image type');
      }

      response.status(HttpStatus.OK).set({
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=86400',
        'Content-Disposition': 'inline',
      });

      remoteResponse.data.pipe(response);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
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
