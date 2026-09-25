import axios, { AxiosInstance, AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JSDOM } from 'jsdom';
import { promises as fs } from 'fs';
import path from 'path';

import { IMediaInfo } from '../interfaces/media-info.interface';
import { timeToMs } from '../core/helpers/time';
import { assertValidHttpUrl, encryptUrlToShortToken } from '../core/helpers/utils';
import { isSameSiteHost } from '../core/helpers/image-proxy';

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
  private readonly logger = new Logger(XMDCentre.name);
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
      this.logger.error(
        `Initialization failed: ${(error as Error)?.message ?? 'unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );
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
      this.logger.log('XMDCentre initialized successfully');
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
    this.logger.error(
      `${context} failed: ${axiosError?.message || 'Unknown error'}`,
      axiosError instanceof Error ? axiosError.stack : undefined,
    );
    if (meta) {
      this.logger.debug(JSON.stringify({ ...meta, status: axiosError?.response?.status, url: axiosError?.config?.url }));
    }

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

class FlashvarsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlashvarsParseError';
  }
}

const FLASHVARS_ASSIGN = /(?:(?:var|let|const)\s+)?(?:window\.)?flashvars\s*=\s*\{/i;

export function parseFlashvarsFromHtml(html: string): Record<string, unknown> {
  if (typeof html !== 'string' || html.trim().length === 0) {
    throw new FlashvarsParseError('flashvars not found');
  }

  for (const source of collectFlashvarsSources(html)) {
    const literal = extractFlashvarsObjectLiteral(source);
    if (!literal) {
      continue;
    }

    const parsed = parseFlashvarsObjectLiteral(literal);
    if (parsed) {
      return parsed;
    }
  }

  throw new FlashvarsParseError('flashvars not found');
}

function collectFlashvarsSources(html: string): string[] {
  const $ = cheerio.load(html);
  const sources: string[] = [];

  $('script').each((_, el) => {
    const text = $(el).html();
    if (text && FLASHVARS_ASSIGN.test(text)) {
      sources.push(text);
    }
  });

  if (sources.length === 0) {
    sources.push(html);
  }

  return sources;
}

function extractFlashvarsObjectLiteral(source: string): string | null {
  const match = source.match(FLASHVARS_ASSIGN);
  if (!match || match.index === undefined) {
    return null;
  }

  const braceAt = match.index + match[0].length - 1;
  return extractBalancedObject(source, braceAt);
}

function extractBalancedObject(source: string, start: number): string | null {
  if (source[start] !== '{') {
    return null;
  }

  let depth = 0;
  let inString: '"' | "'" | null = null;
  let escaped = false;

  for (let i = start; i < source.length; i++) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }

    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }

  return null;
}

function parseFlashvarsObjectLiteral(literal: string): Record<string, unknown> | null {
  try {
    const json = JSON.parse(literal) as unknown;
    if (isPlainRecord(json)) {
      return json;
    }
  } catch {
    /* JS object literal */
  }

  try {
    const parser = new FlashvarsLiteralParser(literal);
    return parser.parseRootObject();
  } catch {
    return null;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

class FlashvarsLiteralParser {
  private i = 0;

  constructor(private readonly src: string) {}

  public parseRootObject(): Record<string, unknown> {
    const value = this.parseValue();
    this.skipWs();
    if (this.i !== this.src.length) {
      throw new FlashvarsParseError('flashvars invalid');
    }
    if (!isPlainRecord(value)) {
      throw new FlashvarsParseError('flashvars invalid');
    }
    return value;
  }

  private parseValue(): unknown {
    this.skipWs();
    const ch = this.src[this.i];

    if (ch === '{') {
      return this.parseObject();
    }
    if (ch === '[') {
      return this.parseArray();
    }
    if (ch === '"' || ch === "'") {
      return this.parseString();
    }
    if (ch === '-' || this.isDigit(ch)) {
      return this.parseNumber();
    }
    if (this.src.startsWith('true', this.i) && this.isTermEnd(this.i + 4)) {
      this.i += 4;
      return true;
    }
    if (this.src.startsWith('false', this.i) && this.isTermEnd(this.i + 5)) {
      this.i += 5;
      return false;
    }
    if (this.src.startsWith('null', this.i) && this.isTermEnd(this.i + 4)) {
      this.i += 4;
      return null;
    }

    throw new FlashvarsParseError('flashvars invalid');
  }

  private parseObject(): Record<string, unknown> {
    this.expect('{');
    const out: Record<string, unknown> = {};
    this.skipWs();

    if (this.peek() === '}') {
      this.i += 1;
      return out;
    }

    while (this.i < this.src.length) {
      this.skipWs();
      const key = this.parseKey();
      this.skipWs();
      this.expect(':');
      out[key] = this.parseValue();
      this.skipWs();

      if (this.peek() === ',') {
        this.i += 1;
        this.skipWs();
        if (this.peek() === '}') {
          this.i += 1;
          return out;
        }
        continue;
      }

      if (this.peek() === '}') {
        this.i += 1;
        return out;
      }

      throw new FlashvarsParseError('flashvars invalid');
    }

    throw new FlashvarsParseError('flashvars invalid');
  }

  private parseArray(): unknown[] {
    this.expect('[');
    const out: unknown[] = [];
    this.skipWs();

    if (this.peek() === ']') {
      this.i += 1;
      return out;
    }

    while (this.i < this.src.length) {
      out.push(this.parseValue());
      this.skipWs();

      if (this.peek() === ',') {
        this.i += 1;
        this.skipWs();
        if (this.peek() === ']') {
          this.i += 1;
          return out;
        }
        continue;
      }

      if (this.peek() === ']') {
        this.i += 1;
        return out;
      }

      throw new FlashvarsParseError('flashvars invalid');
    }

    throw new FlashvarsParseError('flashvars invalid');
  }

  private parseKey(): string {
    const ch = this.peek();
    if (ch === '"' || ch === "'") {
      return this.parseString();
    }

    const start = this.i;
    if (!this.isIdentStart(ch)) {
      throw new FlashvarsParseError('flashvars invalid');
    }
    this.i += 1;
    while (this.i < this.src.length && this.isIdentPart(this.src[this.i])) {
      this.i += 1;
    }
    return this.src.slice(start, this.i);
  }

  private parseString(): string {
    const quote = this.peek();
    if (quote !== '"' && quote !== "'") {
      throw new FlashvarsParseError('flashvars invalid');
    }
    this.i += 1;

    let out = '';
    while (this.i < this.src.length) {
      const ch = this.src[this.i];
      if (ch === quote) {
        this.i += 1;
        return out;
      }
      if (ch === '\\') {
        this.i += 1;
        out += this.parseEscape();
        continue;
      }
      out += ch;
      this.i += 1;
    }

    throw new FlashvarsParseError('flashvars invalid');
  }

  private parseEscape(): string {
    const ch = this.src[this.i];
    if (ch === undefined) {
      throw new FlashvarsParseError('flashvars invalid');
    }
    this.i += 1;

    switch (ch) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case '"':
      case "'":
      case '\\':
      case '/':
        return ch;
      case 'u': {
        const hex = this.src.slice(this.i, this.i + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          throw new FlashvarsParseError('flashvars invalid');
        }
        this.i += 4;
        return String.fromCharCode(Number.parseInt(hex, 16));
      }
      default:
        return ch;
    }
  }

  private parseNumber(): number {
    const start = this.i;
    if (this.peek() === '-') {
      this.i += 1;
    }

    if (!this.isDigit(this.peek())) {
      throw new FlashvarsParseError('flashvars invalid');
    }

    if (this.peek() === '0') {
      this.i += 1;
    } else {
      while (this.isDigit(this.peek())) {
        this.i += 1;
      }
    }

    if (this.peek() === '.') {
      this.i += 1;
      if (!this.isDigit(this.peek())) {
        throw new FlashvarsParseError('flashvars invalid');
      }
      while (this.isDigit(this.peek())) {
        this.i += 1;
      }
    }

    const n = Number(this.src.slice(start, this.i));
    if (!Number.isFinite(n)) {
      throw new FlashvarsParseError('flashvars invalid');
    }
    return n;
  }

  private expect(ch: string): void {
    if (this.src[this.i] !== ch) {
      throw new FlashvarsParseError('flashvars invalid');
    }
    this.i += 1;
  }

  private peek(): string {
    return this.src[this.i];
  }

  private skipWs(): void {
    while (this.i < this.src.length && /\s/.test(this.src[this.i])) {
      this.i += 1;
    }
  }

  private isDigit(ch: string | undefined): boolean {
    return ch !== undefined && ch >= '0' && ch <= '9';
  }

  private isIdentStart(ch: string | undefined): boolean {
    return ch !== undefined && /[A-Za-z_$]/.test(ch);
  }

  private isIdentPart(ch: string | undefined): boolean {
    return ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
  }

  private isTermEnd(index: number): boolean {
    const ch = this.src[index];
    return ch === undefined || /[\s,}\]]/.test(ch);
  }
}
