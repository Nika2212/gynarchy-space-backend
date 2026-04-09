import axios, { AxiosInstance, AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JSDOM, VirtualConsole } from 'jsdom';
import { promises as fs } from 'fs';
import path from 'path';

import { Console } from '../core/helpers/console';
import { IMediaInfo } from '../interfaces/media-info.interface';
import { timeToMs } from '../core/helpers/time';
import { encryptUrlToShortToken } from '../core/helpers/utils';

export const PER_PAGE_SIZE: number = 24;

const KT_PLAYER_TIMEOUT: number = 200;
const KT_PLAYER_RESOLVE_DELAY: number = 100;
const KT_PLAYER_PATH: string = path.join(process.cwd(), 'dist', 'assets', 'kt_player.js');
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

/** Copy flashvars off the JSDOM window before `window.close()` so no realm references are retained. */
function detachFlashvars(vars: object): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(vars)) as Record<string, unknown>;
  } catch {
    return Object.fromEntries(
      Object.entries(vars as Record<string, unknown>).filter(
        ([, v]) =>
          v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
      ),
    );
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
  private readonly initAbort = new AbortController();
  private ktPlayerCache: string | null = null;
  private urlCache: Map<string, string> = new Map<string, string>();

  constructor(private readonly configService: ConfigService) {
    this.base = this.configService.get<string>('XMD') as string;

    if (!this.base) {
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

  onModuleDestroy(): void {
    this.initAbort.abort();
  }

  public async search(keyword: string, page = 1): Promise<IMediaInfo[]> {
    this.validateSearchInput(keyword, page);

    try {
      const { data } = await this.http.get(`/search/${keyword}`, {
        params: {
          mode: 'async',
          function: 'get_block',
          block_id: 'list_videos_videos_list_search_result',
          q: keyword,
          from_videos: page,
          from_albums: page,
        },
        validateStatus: (s) => (s >= 200 && s < 300) || s === 404,
      });

      return this.parseSearch(data);
    } catch (error) {
      this.handleAxiosError(error, 'search()', { keyword, page });
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

      if (this.urlCache.size >= 128) {
        this.urlCache.clear();
      }

      if (!this.urlCache.has(extractedURL)) {
        this.urlCache.set(url, extractedURL);
      }

      return extractedURL;
    } catch (error) {
      this.urlCache.clear();
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
      const node = $(el);

      const thumb = node.find('img.thumb').attr('data-original')?.replace('videos_screenshots', 'videos_sources')?.replace('320x180', 'screenshots');

      if (!thumb) return;

      const url = node.find('a').attr('href');
      if (!url) {
        return;
      }

      const identifier = encryptUrlToShortToken(url);

      results.push({
        title: node.find('strong.title').text().trim(),
        duration: timeToMs(node.find('.duration').text().trim()),
        postedAt: node.find('.added').text().trim(),
        thumbnailSrc: this.expandScreenshots(thumb).map((url) => `/images/${encryptUrlToShortToken(url)}`),
        identifier,
        url: `/media/${identifier}`,
        description: '',
      });
    });

    return results;
  }

  private expandScreenshots(url: string): string[] {
    return Array.from({ length: 6 }, (_, i) => url.replace(/\/\d+\.jpg$/, `/${i + 1}.jpg`));
  }

  private async extractMediaUrl(html: string): Promise<string> {
    const flashvars = this.extractFlashVars(html);
    const ktPlayerScript = await this.loadKtPlayer();

    return this.runKtPlayer(flashvars, ktPlayerScript);
  }

  private extractFlashVars(html: string): Record<string, unknown> {
    const virtualConsole = new VirtualConsole();
    let dom: JSDOM | null = null;

    try {
      dom = new JSDOM(html, {
        runScripts: 'dangerously',
        virtualConsole,
      });

      const vars = dom.window?.flashvars;

      if (!vars || typeof vars !== 'object') {
        throw new MediaExtractionException('flashvars not found');
      }

      return detachFlashvars(vars);
    } finally {
      if (dom) {
        dom.window.close();
      }
    }
  }

  private async loadKtPlayer(): Promise<string> {
    if (this.ktPlayerCache !== null) {
      return this.ktPlayerCache;
    }

    try {
      const content = await fs.readFile(KT_PLAYER_PATH, 'utf8');
      this.ktPlayerCache = content;
      return content;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        throw new MediaExtractionException('kt_player.js missing');
      }
      throw new MediaExtractionException(`Failed to load kt_player.js: ${err.message}`);
    }
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
