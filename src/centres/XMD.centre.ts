import axios, { AxiosInstance, AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import { InternalServerErrorException } from '@nestjs/common';
import { JSDOM, VirtualConsole } from 'jsdom';
import { promises as fs } from 'fs';
import path from 'path';

import { AppConfigProcess } from '../main';
import { Console } from '../core/helpers/console';
import { IMediaInfo } from '../interfaces/media-info.interface';
import { timeToMs } from '../core/helpers/time';

const KT_PLAYER_TIMEOUT = 200;
const KT_PLAYER_RESOLVE_DELAY = 100;
const KT_PLAYER_PATH = path.join(process.cwd(), 'dist', 'assets', 'kt_player.js');
const MIN_SEARCH_KEYWORD_LENGTH = 1;
const MAX_SEARCH_KEYWORD_LENGTH = 200;
const MIN_PAGE_NUMBER = 1;
const MAX_PAGE_NUMBER = 1000;

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

export class XMDCentre {
  private readonly base: string;
  private readonly http: AxiosInstance;
  private ktPlayerCache: string | null = null;

  constructor() {
    this.base = AppConfigProcess.get<string>('XMD') as string;

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
      Console.error({
        context: 'XMDCentre.constructor',
        message: 'Initialization failed',
        error: error?.message,
      });
    });
  }

  async search(keyword: string, page = 1): Promise<IMediaInfo[]> {
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
      });

      return this.parseSearch(data);
    } catch (error) {
      this.handleAxiosError(error, 'search()', { keyword, page });
    }
  }

  async getUrl(url: string): Promise<string> {
    this.validateUrlInput(url);

    try {
      const { data } = await this.http.get(url);
      return await this.extractMediaUrl(data);
    } catch (error) {
      this.handleAxiosError(error, 'getUrl()', { url });
    }
  }

  private async onInit(): Promise<void> {
    try {
      await this.http.head('/');
      Console.success('XMDCentre initialized successfully');
    } catch (error) {
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

      results.push({
        title: node.find('strong.title').text().trim(),
        duration: timeToMs(node.find('.duration').text().trim()),
        postedAt: node.find('.added').text().trim(),
        thumbnailSrc: this.expandScreenshots(thumb),
        url,
        remoteSrc: '',
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

      return vars as Record<string, unknown>;
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

      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        if (resolveTimeout) {
          clearTimeout(resolveTimeout);
          resolveTimeout = null;
        }
        if (dom) {
          try {
            dom.window.close();
          } catch (err) {
          }
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
        window.requestAnimationFrame = (cb) => setTimeout(cb, 0);

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
      throw new XMDCentreException(`Invalid keyword: must be a non-empty string (min length: ${MIN_SEARCH_KEYWORD_LENGTH})`);
    }

    if (keyword.length > MAX_SEARCH_KEYWORD_LENGTH) {
      throw new XMDCentreException(`Invalid keyword: exceeds maximum length of ${MAX_SEARCH_KEYWORD_LENGTH}`);
    }

    if (!Number.isInteger(page) || page < MIN_PAGE_NUMBER || page > MAX_PAGE_NUMBER) {
      throw new XMDCentreException(`Invalid page: must be an integer between ${MIN_PAGE_NUMBER} and ${MAX_PAGE_NUMBER}`);
    }
  }

  private validateUrlInput(url: string): void {
    if (typeof url !== 'string' || url.trim().length === 0) {
      throw new XMDCentreException('Invalid URL: must be a non-empty string');
    }

    try {
      new URL(url);
    } catch {
      if (!url.startsWith('/') && !url.startsWith('./')) {
        throw new XMDCentreException('Invalid URL: must be a valid URL or relative path');
      }
    }
  }
}
