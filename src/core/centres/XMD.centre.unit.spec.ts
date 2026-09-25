import { BadRequestException, HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { promises as fs } from 'fs';
import { JSDOM } from 'jsdom';
import * as urlToken from '../../shared/url-token';
import { XMDCentre } from './XMD.centre';

const PLAYER_OK = `
function kt_player() {
  var id = requestAnimationFrame(function () { throw new Error('raf'); });
  cancelAnimationFrame(id);
  requestAnimationFrame(function () {});
  window.kvsplayer = { kt_player: { conf: { video_alt_url: 'https://cdn.example.com/a.mp4' } } };
}
`;

const PLAYER_URL_ONLY = `
function kt_player() {
  window.kvsplayer = { kt_player: { conf: { video_url: 'https://cdn.example.com/b.mp4' } } };
}
`;

const PLAYER_EMPTY = `function kt_player() { window.kvsplayer = { kt_player: { conf: {} } }; }`;

const SEARCH_HTML = `
<div id="list_videos_videos_list_search_result_items">
  <div class="item">
    <img class="thumb" data-original="https://cdn.example.com/videos_screenshots/320x180/9.jpg" />
    <a href="/videos/1"></a>
    <strong class="title">Title</strong>
    <span class="duration">1:23</span>
    <span class="added">today</span>
  </div>
  <div class="item"></div>
  <div class="item">
    <img class="thumb" data-original="https://cdn.example.com/shot.jpg" />
  </div>
  <div class="item">
    <img class="thumb" data-original="https://cdn.example.com/x.jpg" />
    <a href="ftp://evil.example/v"></a>
  </div>
</div>
`;

const FLASHVARS_HTML = `<script>var flashvars = { video_url: "https://cdn.example.com/src.mp4" };</script>`;

function config(xmd: string | undefined): ConfigService {
  return { get: (key: string) => (key === 'XMD' ? xmd : undefined) } as ConfigService;
}

describe('XMDCentre (unit)', () => {
  let http: { get: jest.Mock; head: jest.Mock };
  let createSpy: jest.SpyInstance;
  let readSpy: jest.SpyInstance;

  beforeEach(() => {
    http = {
      get: jest.fn().mockResolvedValue({ data: SEARCH_HTML }),
      head: jest.fn().mockResolvedValue({}),
    };
    createSpy = jest.spyOn(axios, 'create').mockReturnValue(http as never);
    readSpy = jest.spyOn(fs, 'readFile').mockResolvedValue(PLAYER_OK);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects a missing or non-http base URL', () => {
    expect(() => new XMDCentre(config(undefined))).toThrow('XMD base URL is not configured');
    expect(() => new XMDCentre(config('   '))).toThrow('XMD base URL is not configured');
    expect(() => new XMDCentre(config('ftp://x.test'))).toThrow('XMD base URL is not configured');
  });

  it('logs a failed init and ignores an aborted init', async () => {
    http.head.mockRejectedValueOnce(new Error('boom'));
    const centre = new XMDCentre(config('https://x.test'));
    await new Promise((resolve) => setImmediate(resolve));

    http.head.mockImplementationOnce((_url, options: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          const canceled = new AxiosError('canceled', 'ERR_CANCELED');
          canceled.code = 'ERR_CANCELED';
          reject(canceled);
        });
      });
    });
    const aborted = new XMDCentre(config('https://x.test'));
    aborted.onModuleDestroy();
    await new Promise((resolve) => setImmediate(resolve));

    http.head.mockRejectedValueOnce('nope');
    new XMDCentre(config('https://x.test'));
    await new Promise((resolve) => setImmediate(resolve));
    expect(centre).toBeDefined();
  });

  it('allows same-site http(s) assets only', () => {
    const centre = new XMDCentre(config('https://x.test'));
    expect(centre.isAllowedAssetURL('https://cdn.x.test/a.jpg')).toBe(true);
    expect(centre.isAllowedAssetURL('ftp://x.test/a.jpg')).toBe(false);
    expect(centre.isAllowedAssetURL('not a url')).toBe(false);
  });

  it('parses search HTML and skips incomplete cards', async () => {
    const centre = new XMDCentre(config('https://x.test'));
    http.get.mockImplementation(async (_url, options) => {
      expect(options.validateStatus(200)).toBe(true);
      expect(options.validateStatus(404)).toBe(true);
      expect(options.validateStatus(500)).toBe(false);
      return { data: SEARCH_HTML };
    });

    const results = await centre.search('gynarchy');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Title');
    expect(results[0].thumbnailSrc).toHaveLength(6);
    expect(results[0].url).toMatch(/^\/media\//);

    jest.spyOn(urlToken, 'encryptURLToShortToken').mockImplementation(() => {
      throw new Error('token');
    });
    await expect(centre.search('gynarchy')).resolves.toEqual([]);
  });

  it('rethrows HttpExceptions from search and wraps other errors', async () => {
    const centre = new XMDCentre(config('https://x.test'));
    http.get.mockRejectedValueOnce(new BadRequestException('nope'));
    await expect(centre.search('gynarchy')).rejects.toBeInstanceOf(BadRequestException);

    http.get.mockRejectedValueOnce(new Error('down'));
    await expect(centre.search('gynarchy')).rejects.toThrow('XMDCentre error in search()');

    await expect(centre.search(1 as unknown as string)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('extracts a video URL, caches it, and evicts the oldest entry', async () => {
    const centre = new XMDCentre(config('https://x.test'));
    http.get.mockResolvedValue({ data: FLASHVARS_HTML });

    const first = await centre.getURL('https://x.test/videos/1');
    expect(first).toBe('https://cdn.example.com/a.mp4');
    expect(await centre.getURL('https://x.test/videos/1')).toBe(first);
    expect(http.get).toHaveBeenCalledTimes(1);

    readSpy.mockResolvedValue(PLAYER_URL_ONLY);
    for (let i = 0; i < 128; i += 1) {
      await centre.getURL(`https://x.test/videos/${i + 2}`);
    }
    expect(await centre.getURL('https://x.test/videos/1')).toBe('https://cdn.example.com/a.mp4');
  }, 30_000);

  it('allows relative paths and rejects empty or junk URLs', async () => {
    const centre = new XMDCentre(config('https://x.test'));
    http.get.mockResolvedValue({ data: FLASHVARS_HTML });
    await expect(centre.getURL('/videos/1')).resolves.toBe('https://cdn.example.com/a.mp4');
    await expect(centre.getURL('./videos/1')).resolves.toBe('https://cdn.example.com/a.mp4');
    await expect(centre.getURL('')).rejects.toBeInstanceOf(BadRequestException);
    await expect(centre.getURL('not-a-url')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rethrows HttpExceptions from getURL and wraps other errors', async () => {
    const centre = new XMDCentre(config('https://x.test'));
    http.get.mockRejectedValueOnce(new BadRequestException('nope'));
    await expect(centre.getURL('https://x.test/v')).rejects.toBeInstanceOf(BadRequestException);

    http.get.mockRejectedValueOnce({});
    await expect(centre.getURL('https://x.test/v')).rejects.toThrow('XMDCentre error in getURL()');
  });

  it('fails extraction when flashvars or kt_player are missing', async () => {
    const centre = new XMDCentre(config('https://x.test'));
    http.get.mockResolvedValueOnce({ data: '<html></html>' });
    await expect(centre.getURL('https://x.test/v')).rejects.toThrow('flashvars not found');

    const missing = new Error('missing') as NodeJS.ErrnoException;
    missing.code = 'ENOENT';
    readSpy.mockRejectedValue(missing);
    http.get.mockResolvedValue({ data: FLASHVARS_HTML });
    await expect(centre.getURL('https://x.test/missing-player')).rejects.toThrow('kt_player.js missing');

    readSpy.mockRejectedValue(new Error('eacces'));
    await expect(centre.getURL('https://x.test/bad-player')).rejects.toThrow('Failed to load kt_player.js');

    readSpy.mockRejectedValue('x');
    await expect(centre.getURL('https://x.test/unknown-player')).rejects.toThrow('unknown error');
  });

  it('rejects when kt_player does not resolve a video URL', async () => {
    readSpy.mockResolvedValue(PLAYER_EMPTY);
    const centre = new XMDCentre(config('https://x.test'));
    http.get.mockResolvedValue({ data: FLASHVARS_HTML });
    await expect(centre.getURL('https://x.test/empty')).rejects.toThrow('video URL not resolved');
  });

  it('rejects when JSDOM construction fails', async () => {
    jest.spyOn(JSDOM.prototype as object, 'window', 'get').mockImplementation(() => {
      throw new Error('dom');
    });
    const centre = new XMDCentre(config('https://x.test'));
    http.get.mockResolvedValue({ data: FLASHVARS_HTML });
    await expect(centre.getURL('https://x.test/dom')).rejects.toThrow('XMDCentre error in getURL()');
  });

  it('clears pending animation-frame timers during cleanup', async () => {
    const realSetTimeout = global.setTimeout;
    jest.spyOn(global, 'setTimeout').mockImplementation((fn, ms, ...args) => {
      if (ms === 0) {
        return realSetTimeout(fn as never, 5_000, ...args);
      }
      return realSetTimeout(fn as never, ms as number, ...args);
    });
    readSpy.mockResolvedValue(PLAYER_OK);
    const centre = new XMDCentre(config('https://x.test'));
    http.get.mockResolvedValue({ data: FLASHVARS_HTML });
    await expect(centre.getURL('https://x.test/raf')).resolves.toBe('https://cdn.example.com/a.mp4');
  });

  it('rejects when the kt_player watchdog fires', async () => {
    const realSetTimeout = global.setTimeout;
    jest.spyOn(global, 'setTimeout').mockImplementation((fn, ms, ...args) => {
      if (ms === 2000) {
        (fn as () => void)();
        return 0 as unknown as NodeJS.Timeout;
      }
      return realSetTimeout(fn as never, ms as number, ...args);
    });
    const centre = new XMDCentre(config('https://x.test'));
    http.get.mockResolvedValue({ data: FLASHVARS_HTML });
    await expect(centre.getURL('https://x.test/watchdog')).rejects.toThrow('kt_player timeout');
  });

  it('rejects when the JSDOM queue is full', async () => {
    readSpy.mockResolvedValue('function kt_player() {}');
    const centre = new XMDCentre(config('https://x.test'));
    http.get.mockResolvedValue({ data: FLASHVARS_HTML });

    const pending = Array.from({ length: 12 }, (_, i) => centre.getURL(`https://x.test/q/${i}`));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    await expect(centre.getURL('https://x.test/q/overflow')).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    await Promise.allSettled(pending);
  }, 8000);

  it('releases a queued JSDOM slot after an earlier job finishes', async () => {
    const centre = new XMDCentre(config('https://x.test'));
    http.get.mockResolvedValue({ data: FLASHVARS_HTML });
    const results = await Promise.all([
      centre.getURL('https://x.test/a'),
      centre.getURL('https://x.test/b'),
      centre.getURL('https://x.test/c'),
      centre.getURL('https://x.test/d'),
      centre.getURL('https://x.test/e'),
    ]);
    expect(results.every((url) => url.endsWith('.mp4'))).toBe(true);
  });
});
