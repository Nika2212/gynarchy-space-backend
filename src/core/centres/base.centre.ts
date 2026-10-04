import axios, { AxiosInstance, AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import { BadRequestException, HttpException, InternalServerErrorException, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { IMediaInfo } from '../../shared/interfaces/media-info.interface';
import { timeToMS } from '../../shared/time';
import { assertValidHTTPURL, encryptURLToShortToken } from '../../shared/url-token';
import { isSameSiteHost } from '../../shared/image-type';
import { parseFlashvarsFromHtml } from './flashvars.parser';

const HTTP_TIMEOUT: number = 10_000;
const MAX_RESPONSE_BYTES: number = 5_000_000;
const URL_CACHE_LIMIT: number = 128;
const MAX_SEARCH_KEYWORD_LENGTH: number = 200;
const MIN_PAGE_NUMBER: number = 1;
const MAX_PAGE_NUMBER: number = 1000;
// Listings have screenshots 1-5; a 6th is not guaranteed, so it is never requested.
const SCREENSHOT_COUNT: number = 5;

export class CentreException extends InternalServerErrorException {
  // Builds a centre error with an optional debug payload.
  constructor(message: string, meta?: Record<string, any>) {
    super({ message, meta });
  }
}

export class MediaExtractionException extends CentreException {
  // Builds an error when the video URL cannot be extracted from a page.
  constructor(reason: string) {
    super(`Media extraction failed: ${reason}`);
  }
}

// True when the startup HEAD request was canceled on shutdown.
function isInitAbortedError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }
  return error.code === 'ERR_CANCELED' || error.message === 'canceled';
}

export abstract class BaseCentre implements OnModuleDestroy {
  public readonly source: string;
  protected readonly logger: Logger;
  protected readonly name: string;
  protected readonly base: string;
  protected readonly http: AxiosInstance;
  private readonly initAbort: AbortController = new AbortController();
  private URLCache: Map<string, string> = new Map<string, string>();

  // Reads the base URL from the given env key, builds the HTTP client, and starts a health check.
  protected constructor(configService: ConfigService, envKey: string) {
    this.source = envKey.toLowerCase();
    this.name = `${envKey}Centre`;
    this.logger = new Logger(this.name);
    this.base = (configService.get<string>(envKey) ?? '').trim();

    if (!this.base) {
      throw new CentreException(`${envKey} base URL is not configured`);
    }

    try {
      assertValidHTTPURL(this.base);
    } catch {
      throw new CentreException(`${envKey} base URL is not configured`);
    }

    this.http = axios.create({
      baseURL: this.base,
      timeout: HTTP_TIMEOUT,
      responseType: 'text',
      maxContentLength: MAX_RESPONSE_BYTES,
      headers: {
        'User-Agent': `${this.name}/1.0`,
      },
    });

    void this.onInit();
  }

  // Turns a fetched media page into the playable video URL.
  protected abstract extractMediaURL(html: string): Promise<string>;

  // Picks the raw thumbnail path from a search card's <img class="thumb"> attributes.
  protected abstract pickThumbnail(attributes: Record<string, string>): string | undefined;

  // Picks the raw short preview video path from a search card's <img class="thumb"> attributes; none by default.
  protected pickPreview(_attributes: Record<string, string>): string | undefined {
    return undefined;
  }

  // Builds the sequential screenshot URLs (1.jpg to 5.jpg) from one thumbnail path.
  protected expandScreenshots(url: string): string[] {
    return Array.from({ length: SCREENSHOT_COUNT }, (_, i) => url.replace(/\/\d+\.jpg$/, `/${i + 1}.jpg`));
  }

  // Cancels the in-flight init request when the module shuts down.
  public onModuleDestroy(): void {
    this.initAbort.abort();
  }

  // True when the URL is http(s) and lives on the same site as the centre base.
  public isAllowedAssetURL(url: string): boolean {
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

  // Fetches one search page and returns parsed media cards. An empty or missing keyword searches with an empty query.
  public async search(keyword: string, page = 1): Promise<IMediaInfo[]> {
    const normalizedKeyword = keyword === undefined ? '' : typeof keyword === 'string' ? keyword.trim() : keyword;
    this.validateSearchInput(normalizedKeyword, page);
    const slug = this.toSearchSlug(normalizedKeyword);

    try {
      const { data } = await this.http.get(this.searchPath(slug), {
        params: this.searchParams(slug, page),
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

  // Resolves a page URL to the playable video URL, using a small cache.
  public async getURL(url: string): Promise<string> {
    if (this.URLCache.has(url)) {
      return this.URLCache.get(url) as string;
    }

    this.validateURLInput(url);

    try {
      const { data } = await this.http.get(url);
      if (typeof data !== 'string') {
        throw new MediaExtractionException('page is not HTML');
      }
      const extractedURL = await this.extractMediaURL(data);

      if (this.URLCache.size >= URL_CACHE_LIMIT) {
        const oldest = this.URLCache.keys().next().value;
        if (oldest !== undefined) {
          this.URLCache.delete(oldest);
        }
      }

      this.URLCache.set(url, extractedURL);
      return extractedURL;
    } catch (error) {
      this.URLCache.delete(url);
      if (error instanceof HttpException) {
        throw error;
      }
      this.handleAxiosError(error, 'getURL()', { url });
    }
  }

  // Search URL path for a slug; sources that need a trailing slash override it.
  protected searchPath(slug: string): string {
    return `/search/${encodeURIComponent(slug)}`;
  }

  // Query params for the KVS async search block; sources add their own extras by overriding.
  protected searchParams(slug: string, page: number): Record<string, unknown> {
    return {
      mode: 'async',
      function: 'get_block',
      block_id: 'list_videos_videos_list_search_result',
      q: slug,
      from_videos: page,
      from_albums: page,
    };
  }

  // Turns a relative or absolute path into an absolute http(s) URL.
  protected toAbsoluteHTTPURL(url: string): string | undefined {
    try {
      const absolute = new URL(url, this.base).href;
      assertValidHTTPURL(absolute);
      return absolute;
    } catch {
      return undefined;
    }
  }

  // Parses flashvars from the page, or throws if they are missing.
  protected extractFlashVars(html: string): Record<string, unknown> {
    try {
      return parseFlashvarsFromHtml(html);
    } catch {
      throw new MediaExtractionException('flashvars not found');
    }
  }

  // Pings the home page so a bad base URL is logged at startup.
  private async onInit(): Promise<void> {
    try {
      await this.http.head('/', { signal: this.initAbort.signal });
      this.logger.log(`${this.name} initialized successfully`);
    } catch (error) {
      if (isInitAbortedError(error)) {
        return;
      }
      const err = error as Error;
      this.logger.error(
        err?.message || 'Unknown initialization error',
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  // Reads search-result cards from HTML into media info objects. A non-HTML body yields no cards.
  private parseSearch(html: unknown): IMediaInfo[] {
    if (typeof html !== 'string' || html.trim().length === 0) {
      return [];
    }

    const $ = cheerio.load(html);
    const results: IMediaInfo[] = [];

    $('#list_videos_videos_list_search_result_items .item').each((_, el) => {
      try {
        const node = $(el);

        const imageAttributes = node.find('img.thumb').first().attr() ?? {};

        const rawThumb = this.pickThumbnail(imageAttributes);
        const thumb = rawThumb ? this.toAbsoluteHTTPURL(rawThumb) : undefined;
        if (!thumb) {
          return;
        }

        const rawPreview = this.pickPreview(imageAttributes);
        const preview = rawPreview ? this.toAbsoluteHTTPURL(rawPreview) : undefined;

        const href = node.find('a').first().attr('href');
        const url = href ? this.toAbsoluteHTTPURL(href) : undefined;
        if (!url) {
          return;
        }

        const identifier = encryptURLToShortToken(url);

        results.push({
          title: node.find('strong.title').text().trim(),
          duration: timeToMS(node.find('.duration').text().trim()),
          postedAt: node.find('.added').text().trim(),
          thumbnailSrc: this.expandScreenshots(thumb).map((shot) => {
            const absolute = this.toAbsoluteHTTPURL(shot) ?? shot;
            return `/images/${encryptURLToShortToken(absolute)}`;
          }),
          ...(preview ? { previewSrc: `/previews/${encryptURLToShortToken(preview)}` } : {}),
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

  // Logs an HTTP failure and throws a centre error for the caller.
  private handleAxiosError(error: unknown, context: string, meta?: Record<string, unknown>): never {
    const axiosError = error as AxiosError;
    this.logger.error(
      `${context} failed: ${axiosError?.message || 'Unknown error'}`,
      axiosError instanceof Error ? axiosError.stack : undefined,
    );
    if (meta) {
      this.logger.debug(JSON.stringify({ ...meta, status: axiosError?.response?.status, url: axiosError?.config?.url }));
    }

    throw new CentreException(`${this.name} error in ${context}`, meta);
  }

  // Search URLs use lowercase words joined by dashes: "Gynarchy Space" -> "gynarchy-space".
  private toSearchSlug(keyword: string): string {
    return keyword.toLowerCase().split(/\s+/).filter(Boolean).join('-');
  }

  // Rejects non-string or too-long keywords and out-of-range pages. An empty keyword is allowed.
  private validateSearchInput(keyword: string, page: number): void {
    if (typeof keyword !== 'string') {
      throw new BadRequestException('Invalid keyword: must be a string');
    }

    if (keyword.length > MAX_SEARCH_KEYWORD_LENGTH) {
      throw new BadRequestException(`Invalid keyword: exceeds maximum length of ${MAX_SEARCH_KEYWORD_LENGTH}`);
    }

    if (!Number.isInteger(page) || page < MIN_PAGE_NUMBER || page > MAX_PAGE_NUMBER) {
      throw new BadRequestException(`Invalid page: must be an integer between ${MIN_PAGE_NUMBER} and ${MAX_PAGE_NUMBER}`);
    }
  }

  // Rejects empty values that are neither a URL nor a relative path.
  private validateURLInput(url: string): void {
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
