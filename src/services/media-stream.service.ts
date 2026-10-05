import { BadRequestException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import type { Response } from 'express';
import { CentreRegistry } from '../core/centres/centre.registry';
import { isPublicHTTPHost } from '../shared/image-type';
import { decryptShortTokenToURL } from '../shared/url-token';
import { DownloadService } from './download.service';

@Injectable()
export class MediaStreamService {
  constructor(
    private readonly centreRegistry: CentreRegistry,
    private readonly downloadService: DownloadService,
  ) {}

  // Resolves the video URL and pipes the remote stream, including Range support.
  public async stream(id: string, range: string, response: Response): Promise<void> {
    if (!id) {
      throw new NotFoundException('Invalid media id');
    }

    const originURL = decryptShortTokenToURL(id);
    if (!originURL) {
      throw new NotFoundException('Invalid media id');
    }

    const centre = this.centreRegistry.findByURL(originURL);
    if (!centre) {
      throw new NotFoundException('Invalid media id');
    }

    const storedURL = await this.downloadService.playbackURL(id);
    if (storedURL) {
      response.redirect(HttpStatus.FOUND, storedURL);
      return;
    }

    const decryptedURL = await centre.getURL(originURL);
    return this.pipe(decryptedURL, range, response);
  }

  // Pipes a card's short preview video; the id is the preview URL itself, so no page lookup is needed.
  public async preview(id: string, range: string, response: Response): Promise<void> {
    if (!id) {
      throw new NotFoundException('Invalid preview id');
    }

    const previewURL = decryptShortTokenToURL(id);
    if (!previewURL || !this.centreRegistry.isAllowedAssetURL(previewURL)) {
      throw new NotFoundException('Invalid preview id');
    }

    return this.pipe(previewURL, range, response);
  }

  // Fetches a remote video and pipes it to the client, forwarding Range so seeking works.
  private async pipe(decryptedURL: string, range: string, response: Response): Promise<void> {
    const abort = new AbortController();
    // Stops the remote fetch when the client closes the response.
    const onClose = (): void => abort.abort();
    response.once('close', onClose);

    try {
      if (!isPublicHTTPHost(new URL(decryptedURL).hostname)) {
        throw new BadRequestException('Invalid media url');
      }

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
        remoteResponse.status === HttpStatus.PARTIAL_CONTENT ? HttpStatus.PARTIAL_CONTENT : HttpStatus.OK;

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
}
