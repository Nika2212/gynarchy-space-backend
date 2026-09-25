import axios, { AxiosInstance, AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JSDOM } from 'jsdom';
import { promises as fs } from 'fs';
import path from 'path';

import { Console } from '../core/helpers/console';
import { IMediaInfo } from '../interfaces/media-info.interface';
import { timeToMs } from '../core/helpers/time';
import { assertValidHttpUrl, encryptUrlToShortToken } from '../core/helpers/utils';
import { isSameSiteHost } from '../core/helpers/image-proxy';
import { parseFlashvarsFromHtml } from './xmd-flashvars';

export const PER_PAGE_SIZE: number = 24;

const KT_PLAYER_TIMEOUT: number = 2000;
const KT_PLAYER_RESOLVE_DELAY: number = 200;
const KT_PLAYER_PATHS: string[] = [
  path.join(__dirname, '..', 'assets', 'kt_player.js'),
  path.join(process.cwd(), 'dist', 'assets', 'kt_player.js'),
  path.join(process.cwd(), 'src', 'assets', 'kt_player.js'),
];
const URL_CACHE_LIMIT: number = 128;
const JSDOM_CONCURRENCY: number = 4;
const JSDOM_QUEUE_LIMIT: number = 8;
const MIN_SEARCH_KEYWORD_LENGTH: number = 1;
const MAX_SEARCH_KEYWORD_LENGTH: number = 200;
const MIN_PAGE_NUMBER: number = 1;
const MAX_PAGE_NUMBER: number = 1000;

class XMDCentreException extends InternalServerErrorException {
  constructor(message: string, meta?: Record<string, any>) {
    super({ message, meta });
  }
}

class MediaExtractionException extends XMDCentreException {
  constructor(reason: string) {
    super(`Media extraction failed: ${reason}`);
  }
}

function isInitAbortedError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }
  return error.code === 'ERR_CANCELED' || error.message === 'canceled';
}

@Injectable()
export class XMDCentre implements OnModuleDestroy {
  private readonly base: string;
  private readonly http: AxiosInstance;
  private readonly initAbort: AbortController = new AbortController();
  private ktPlayerCache: string | null = null;
  private urlCache: Map<string, string> = new Map<string, string>();
  private jsdomInFlight = 0;
  private readonly jsdomQueue: Array<() => void> = [];

  constructor(private readonly configService: ConfigService) {
    this.base = (this.configService.get<string>('XMD') ?? '').trim();

    if (!this.base) {
      throw new XMDCentreException('XMD base URL is not configured');
    }

    try {
      assertValidHttpUrl(this.base);
    } catch {
      throw new XMDCentreException('XMD base URL is not configured');
    }

    this.http = axios.create({
      baseURL: this.base,
      timeout: 10_000,
      headers: {
        'User-Agent': 'XMDCentre/1.0',
      },
    });

    void this.onInit().catch((error) => {
      if (isInitAbortedError(error)) {
        return;
      }
      Console.error({
        context: 'XMDCentre.constructor',
        message: 'Initialization failed',
        error: (error as Error)?.message,
      });
    });
  }

  public onModuleDestroy(): void {
    this.initAbort.abort();
  }

  public isAllowedAssetUrl(url: string): boolean {
    try {
      const target = new URL(url);
      if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        return false;
      }
      return isSameSiteHost(target.hostname, new URL(this.base).hostname);
    } catch {
      return false;
    }
  }

  public async search(keyword: string, page = 1): Promise<IMediaInfo[]> {
    const normalizedKeyword = typeof keyword === 'string' ? keyword.trim() : keyword;
    this.validateSearchInput(normalizedKeyword, page);

    try {
      const { data } = await this.http.get(`/search/${encodeURIComponent(normalizedKeyword)}`, {
        params: {
          mode: 'async',
          function: 'get_block',
          block_id: 'list_videos_videos_list_search_result',
          q: normalizedKeyword,
          from_videos: page,
          from_albums: page,
        },
        validateStatus: (s) => (s >= 200 && s < 300) || s === 404,
      });

      return this.parseSearch(data);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.handleAxiosError(error, 'search()', { keyword: normalizedKeyword, page });
    }
  }

  public async getUrl(url: string): Promise<string> {
    if (this.urlCache.has(url)) {
      return this.urlCache.get(url) as string;
    }

    this.validateUrlInput(url);

    try {
      const { data } = await this.http.get(url);
      const extractedURL = await this.extractMediaUrl(data);

      if (this.urlCache.size >= URL_CACHE_LIMIT) {
        const oldest = this.urlCache.keys().next().value;
        if (oldest !== undefined) {
          this.urlCache.delete(oldest);
        }
      }

      this.urlCache.set(url, extractedURL);
      return extractedURL;
    } catch (error) {
      this.urlCache.delete(url);
      if (error instanceof HttpException) {
        throw error;
      }
      this.handleAxiosError(error, 'getUrl()', { url });
    }
  }

  private async onInit(): Promise<void> {
    try {
      await this.http.head('/', { signal: this.initAbort.signal });
      Console.success('XMDCentre initialized successfully');
    } catch (error) {
      if (isInitAbortedError(error)) {
        return;
      }
      const err = error as Error;
      Console.error({
        context: 'XMDCentre.onInit',
        message: err?.message || 'Unknown initialization error',
      });
    }
  }

  private parseSearch(html: string): IMediaInfo[] {
    const $ = cheerio.load(html);
    const results: IMediaInfo[] = [];

    $('#list_videos_videos_list_search_result_items .item').each((_, el) => {
      try {
        const node = $(el);

        const rawThumb = node
          .find('img.thumb')
          .attr('data-original')
          ?.replace('videos_screenshots', 'videos_sources')
          ?.replace('320x180', 'screenshots');
        const thumb = rawThumb ? this.toAbsoluteHttpUrl(rawThumb) : undefined;
        if (!thumb) {
          return;
        }

        const href = node.find('a').attr('href');
        const url = href ? this.toAbsoluteHttpUrl(href) : undefined;
        if (!url) {
          return;
        }

        const identifier = encryptUrlToShortToken(url);

        results.push({
          title: node.find('strong.title').text().trim(),
          duration: timeToMs(node.find('.duration').text().trim()),
          postedAt: node.find('.added').text().trim(),
          thumbnailSrc: this.expandScreenshots(thumb).map((shot) => {
            const absolute = this.toAbsoluteHttpUrl(shot) ?? shot;
            return `/images/${encryptUrlToShortToken(absolute)}`;
          }),
          identifier,
          url: `/media/${identifier}`,
          description: '',
        });
      } catch {
        return;
      }
    });

    return results;
  }

  private toAbsoluteHttpUrl(url: string): string | undefined {
    try {
      const absolute = new URL(url, this.base).href;
      assertValidHttpUrl(absolute);
      return absolute;
    } catch {
      return undefined;
    }
  }

  private expandScreenshots(url: string): string[] {
    return Array.from({ length: 6 }, (_, i) => url.replace(/\/\d+\.jpg$/, `/${i + 1}.jpg`));
  }

  private async extractMediaUrl(html: string): Promise<string> {
    const flashvars = this.extractFlashVars(html);
    const ktPlayerScript = await this.loadKtPlayer();

    return this.withJsdomSlot(() => this.runKtPlayer(flashvars, ktPlayerScript));
  }

  private async withJsdomSlot<T>(run: () => Promise<T>): Promise<T> {
    await this.acquireJsdomSlot();
    try {
      return await run();
    } finally {
      this.releaseJsdomSlot();
    }
  }

  private acquireJsdomSlot(): Promise<void> {
    if (this.jsdomInFlight < JSDOM_CONCURRENCY) {
      this.jsdomInFlight += 1;
      return Promise.resolve();
    }

    if (this.jsdomQueue.length >= JSDOM_QUEUE_LIMIT) {
      throw new HttpException('Playback capacity exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }

    return new Promise((resolve) => {
      this.jsdomQueue.push(() => {
        this.jsdomInFlight += 1;
        resolve();
      });
    });
  }

  private releaseJsdomSlot(): void {
    this.jsdomInFlight = Math.max(0, this.jsdomInFlight - 1);
    const next = this.jsdomQueue.shift();
    if (next) {
      next();
    }
  }

  private extractFlashVars(html: string): Record<string, unknown> {
    try {
      return parseFlashvarsFromHtml(html);
    } catch {
      throw new MediaExtractionException('flashvars not found');
    }
  }

  private async loadKtPlayer(): Promise<string> {
    if (this.ktPlayerCache !== null) {
      return this.ktPlayerCache;
    }

    let lastError: NodeJS.ErrnoException | undefined;

    for (const candidate of KT_PLAYER_PATHS) {
      try {
        const content = await fs.readFile(candidate, 'utf8');
        this.ktPlayerCache = content;
        return content;
      } catch (error) {
        lastError = error as NodeJS.ErrnoException;
      }
    }

    if (lastError?.code === 'ENOENT') {
      throw new MediaExtractionException('kt_player.js missing');
    }
    throw new MediaExtractionException(`Failed to load kt_player.js: ${lastError?.message ?? 'unknown error'}`);
  }

  private runKtPlayer(flashvars: Record<string, unknown>, scriptContent: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let timeout: NodeJS.Timeout | null = null;
      let resolveTimeout: NodeJS.Timeout | null = null;
      let dom: JSDOM | null = null;
      const rafTimerById = new Map<number, ReturnType<typeof setTimeout>>();
      let nextRafId = 1;

      const clearAllRafTimers = (): void => {
        for (const t of rafTimerById.values()) {
          clearTimeout(t);
        }
        rafTimerById.clear();
      };

      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        if (resolveTimeout) {
          clearTimeout(resolveTimeout);
          resolveTimeout = null;
        }
        clearAllRafTimers();
        if (dom) {
          try {
            dom.window.close();
          } catch (err) {}
          dom = null;
        }
      };

      timeout = setTimeout(() => {
        cleanup();
        reject(new MediaExtractionException('kt_player timeout'));
      }, KT_PLAYER_TIMEOUT);

      try {
        dom = new JSDOM(`<!DOCTYPE html><div id="kt_player"></div>`, {
          runScripts: 'dangerously',
          url: 'http://localhost/',
        });

        const { window } = dom;
        window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
          const id = nextRafId++;
          const handle = setTimeout(() => {
            rafTimerById.delete(id);
            try {
              cb(Date.now());
            } catch {
              /* script errors surface via kt_player path */
            }
          }, 0);
          rafTimerById.set(id, handle);
          return id;
        };
        window.cancelAnimationFrame = (id: number): void => {
          const handle = rafTimerById.get(id);
          if (handle !== undefined) {
            clearTimeout(handle);
            rafTimerById.delete(id);
          }
        };

        const script = window.document.createElement('script');
        script.textContent = scriptContent;
        window.document.body.appendChild(script);

        (window as unknown as { kt_player: (...args: unknown[]) => void }).kt_player('kt_player', '', '100%', '100%', flashvars);

        resolveTimeout = setTimeout(() => {
          try {
            const conf = (window as unknown as { kvsplayer?: { kt_player?: { conf?: { video_alt_url?: string; video_url?: string } } } })?.kvsplayer?.kt_player?.conf;
            const videoUrl = conf?.video_alt_url ?? conf?.video_url;

            if (!videoUrl || typeof videoUrl !== 'string') {
              throw new MediaExtractionException('video URL not resolved');
            }

            cleanup();
            resolve(videoUrl);
          } catch (err) {
            cleanup();
            reject(err);
          }
        }, KT_PLAYER_RESOLVE_DELAY);
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  }

  private handleAxiosError(error: unknown, context: string, meta?: Record<string, unknown>): never {
    const axiosError = error as AxiosError;
    Console.error({
      context,
      meta,
      status: axiosError?.response?.status,
      url: axiosError?.config?.url,
      message: axiosError?.message || 'Unknown error',
    });

    throw new XMDCentreException(`XMDCentre error in ${context}`, meta);
  }

  private validateSearchInput(keyword: string, page: number): void {
    if (typeof keyword !== 'string' || keyword.trim().length < MIN_SEARCH_KEYWORD_LENGTH) {
      throw new BadRequestException(`Invalid keyword: must be a non-empty string (min length: ${MIN_SEARCH_KEYWORD_LENGTH})`);
    }

    if (keyword.length > MAX_SEARCH_KEYWORD_LENGTH) {
      throw new BadRequestException(`Invalid keyword: exceeds maximum length of ${MAX_SEARCH_KEYWORD_LENGTH}`);
    }

    if (!Number.isInteger(page) || page < MIN_PAGE_NUMBER || page > MAX_PAGE_NUMBER) {
      throw new BadRequestException(`Invalid page: must be an integer between ${MIN_PAGE_NUMBER} and ${MAX_PAGE_NUMBER}`);
    }
  }

  private validateUrlInput(url: string): void {
    if (typeof url !== 'string' || url.trim().length === 0) {
      throw new BadRequestException('Invalid URL: must be a non-empty string');
    }

    try {
      new URL(url);
    } catch {
      if (!url.startsWith('/') && !url.startsWith('./')) {
        throw new BadRequestException('Invalid URL: must be a valid URL or relative path');
      }
    }
  }
}
