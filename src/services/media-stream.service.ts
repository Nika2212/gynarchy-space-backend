import { BadRequestException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import type { Response } from 'express';
import { CentreRegistry } from '../core/centres/centre.registry';
import { isPublicHTTPHost } from '../shared/image-type';
import { decryptShortTokenToURL } from '../shared/url-token';
import { DownloadService } from './download.service';

@Injectable()
export class MediaStreamService {
  private readonly logger = new Logger(MediaStreamService.name);

  constructor(
    private readonly centreRegistry: CentreRegistry,
    private readonly downloadService: DownloadService,
  ) {}

  // Resolves the video URL and pipes the remote stream, including Range support. A stored copy is served from storage unless
  // the player asked for the source (fromSource) or storage is refusing downloads right now.
  public async stream(id: string, range: string, response: Response, fromSource = false): Promise<void> {
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

    const storedURL = fromSource || !this.downloadService.isStorageReadable() ? null : await this.downloadService.playbackURL(id);
    if (storedURL) {
      response.redirect(HttpStatus.FOUND, storedURL);
      return;
    }

    const decryptedURL = await centre.getURL(originURL);
    return this.pipe(decryptedURL, range, response, centre.videoRequestHeaders(), originURL);
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

    return this.pipe(previewURL, range, response, this.centreRegistry.findByURL(previewURL)?.videoRequestHeaders() ?? {}, previewURL);
  }

  // Fetches a remote video and pipes it to the client, forwarding Range so seeking works. A refused or non-video answer is logged
  // with the page it belongs to, so a video that will not play can be traced to its source.
  private async pipe(decryptedURL: string, range: string, response: Response, sourceHeaders: Record<string, string>, pageURL: string): Promise<void> {
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
        headers: { ...sourceHeaders, ...(range ? { Range: range } : {}) },
        validateStatus: (status) => status === HttpStatus.OK || status === HttpStatus.PARTIAL_CONTENT,
      });

      const contentType = String(remoteResponse.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (!contentType.startsWith('video/') && contentType !== 'application/octet-stream') {
        remoteResponse.data.destroy();
        this.logger.warn(`Source sent ${contentType || 'no content type'} instead of a video for ${pageURL} (${this.describe(decryptedURL)})`);
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
      if (!abort.signal.aborted) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        const type = axios.isAxiosError(error) ? String(error.response?.headers?.['content-type'] ?? '-').split(';')[0] : '-';
        this.logger.warn(`Source refused ${pageURL} (${this.describe(decryptedURL)}): ${status ? `${status} ${type}` : (error as Error)?.message ?? 'unknown error'}`);
      }
      if (!response.headersSent) {
        response.status(HttpStatus.BAD_GATEWAY).send('Error fetching remote stream');
      }
    }
  }

  // Host and path of a source file link, without the signed query string.
  private describe(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.host}${parsed.pathname}`;
    } catch {
      return 'invalid URL';
    }
  }
}
