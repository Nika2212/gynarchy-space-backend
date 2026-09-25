require('dotenv').config({ path: '.env' });

import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { parseFlashvarsFromHtml, XMDCentre } from './XMD.centre';

const mockConfig = new Map<string, string>();

function createConfigServiceMock(): ConfigService {
  return { get: (key: string) => mockConfig.get(key) } as ConfigService;
}

const NETWORK_TIMEOUT = 30_000;

describe('parseFlashvarsFromHtml', () => {
  it('parses JSON flashvars from a script tag', () => {
    const html = `
      <html><script>
        var flashvars = {"video_id":"12","video_url":"https://cdn.example.com/a.mp4"};
      </script></html>
    `;

    expect(parseFlashvarsFromHtml(html)).toEqual({
      video_id: '12',
      video_url: 'https://cdn.example.com/a.mp4',
    });
  });

  it('parses unquoted keys and single-quoted values', () => {
    const html = `
      <script>
        var flashvars = {
          video_id: '12',
          license_code: 'abc',
          rnd: 7,
        };
      </script>
    `;

    expect(parseFlashvarsFromHtml(html)).toEqual({
      video_id: '12',
      license_code: 'abc',
      rnd: 7,
    });
  });

  it('parses window.flashvars assignment', () => {
    const html = `<script>window.flashvars = { video_url: "https://x.test/v.mp4" };</script>`;
    expect(parseFlashvarsFromHtml(html).video_url).toBe('https://x.test/v.mp4');
  });

  it('does not execute expressions inside flashvars', () => {
    const html = `
      <script>
        var flashvars = { video_url: (function(){ throw new Error('executed') })() };
      </script>
    `;

    expect(() => parseFlashvarsFromHtml(html)).toThrow('flashvars not found');
  });

  it('rejects identifier values such as require', () => {
    const html = `<script>var flashvars = { x: require('fs') };</script>`;
    expect(() => parseFlashvarsFromHtml(html)).toThrow('flashvars not found');
  });

  it('throws when flashvars is missing', () => {
    expect(() => parseFlashvarsFromHtml('<html><body></body></html>')).toThrow('flashvars not found');
  });
});

describe('XMDCentre (integration)', () => {
  let centre: XMDCentre;
  const searchKeyword = 'gynarchy';

  beforeAll(() => {
    const xmdUrl = process.env.XMD;
    if (!xmdUrl) {
      throw new Error('XMD env variable is required — add it to .env at the project root');
    }

    mockConfig.set('XMD', xmdUrl);
    centre = new XMDCentre(createConfigServiceMock());
  });

  describe('search()', () => {
    it(
      'should return results with correct IMediaInfo shape',
      async () => {
        const results = await centre.search(searchKeyword);

        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeGreaterThan(0);

        for (const item of results) {
          expect(item).toMatchObject({
            title: expect.any(String),
            url: expect.any(String),
            duration: expect.any(Number),
            postedAt: expect.any(String),
            thumbnailSrc: expect.any(Array),
            description: '',
          });

          expect(item.title.length).toBeGreaterThan(0);
          expect(item.url.length).toBeGreaterThan(0);
          expect(item.duration).toBeGreaterThanOrEqual(0);
          expect(item.thumbnailSrc).toHaveLength(6);
          item.thumbnailSrc.forEach((src) => {
            expect(typeof src).toBe('string');
            expect(src.length).toBeGreaterThan(0);
          });
        }
      },
      NETWORK_TIMEOUT,
    );

    it(
      'should return non-empty results for page 1 and page 2',
      async () => {
        const page1 = await centre.search(searchKeyword, 1);
        const page2 = await centre.search(searchKeyword, 2);

        expect(page1.length).toBeGreaterThan(0);
        expect(page2.length).toBeGreaterThan(0);
      },
      NETWORK_TIMEOUT,
    );

    it('should reject empty keyword with 400 Bad Request', async () => {
      await expect(centre.search('')).rejects.toBeInstanceOf(BadRequestException);
      await expect(centre.search('   ')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should reject keyword exceeding max length with 400 Bad Request', async () => {
      await expect(centre.search('a'.repeat(201))).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should reject invalid page numbers with 400 Bad Request', async () => {
      await expect(centre.search(searchKeyword, 0)).rejects.toBeInstanceOf(BadRequestException);
      await expect(centre.search(searchKeyword, -1)).rejects.toBeInstanceOf(BadRequestException);
      await expect(centre.search(searchKeyword, 1001)).rejects.toBeInstanceOf(BadRequestException);
      await expect(centre.search(searchKeyword, 1.5)).rejects.toBeInstanceOf(BadRequestException);
    });

    it(
      'should return empty array for gibberish keyword with no matches',
      async () => {
        const results = await centre.search('zxqjkww1829nonsense');
        expect(Array.isArray(results)).toBe(true);
      },
      NETWORK_TIMEOUT,
    );
  });

  describe('getUrl()', () => {
    it('should reject empty URL with 400 Bad Request', async () => {
      await expect(centre.getUrl('')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should reject invalid URL format with 400 Bad Request', async () => {
      await expect(centre.getUrl('not-a-url')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
