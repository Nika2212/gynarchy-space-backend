import { BadRequestException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import type { Response } from 'express';
import { XMDCentre } from '../core/centres/XMD.centre';
import { isPublicHTTPHost, normalizeAllowedImageType } from '../shared/image-type';
import { decryptShortTokenToURL } from '../shared/url-token';

@Injectable()
export class ImageProxyService {
  constructor(private readonly xmdCentre: XMDCentre) {}

  // Fetches an allowed thumbnail URL and pipes the image bytes to the client.
  public async proxy(id: string, response: Response): Promise<void> {
    if (!id) {
      throw new NotFoundException('Invalid image id');
    }

    const decryptedURL = decryptShortTokenToURL(id);
    if (!decryptedURL) {
      throw new NotFoundException('Invalid image id');
    }

    if (!isPublicHTTPHost(new URL(decryptedURL).hostname)) {
      throw new BadRequestException('Invalid image url');
    }

    if (!this.xmdCentre.isAllowedAssetURL(decryptedURL)) {
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
}
