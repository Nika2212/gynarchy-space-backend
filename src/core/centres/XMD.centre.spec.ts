require('dotenv').config({ path: '.env' });

import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { extractBalancedObject, FlashvarsLiteralParser, parseFlashvarsFromHtml } from './flashvars.parser';
import { XMDCentre } from './XMD.centre';

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

  it('follows a randomly named flashvars variable passed to kt_player', () => {
    const html = `
      <script>
        var other = { video_url: 'https://x.test/wrong.mp4' };
        var tc7ff1901fc = { video_id: '16971', video_url: 'function/0/https://x.test/v.mp4/' };
        window['player_obj'] = kt_player('kt_player', 'https://x.test/kt_player.swf', '100%', '100%', tc7ff1901fc);
      </script>
    `;

    expect(parseFlashvarsFromHtml(html)).toEqual({ video_id: '16971', video_url: 'function/0/https://x.test/v.mp4/' });
  });

  it('does not match a variable that only ends with the flashvars name', () => {
    expect(() => parseFlashvarsFromHtml('<script>var notflashvars = { a: 1 };</script>')).toThrow('flashvars not found');
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

  it('throws for blank or non-string HTML', () => {
    expect(() => parseFlashvarsFromHtml('')).toThrow('flashvars not found');
    expect(() => parseFlashvarsFromHtml('   ')).toThrow('flashvars not found');
    expect(() => parseFlashvarsFromHtml(undefined as unknown as string)).toThrow('flashvars not found');
  });

  it('parses flashvars that are not inside a script tag', () => {
    expect(parseFlashvarsFromHtml('var flashvars = { video_url: "https://x.test/v.mp4" };').video_url).toBe(
      'https://x.test/v.mp4',
    );
  });

  it('parses arrays, nested objects, keywords, and escapes', () => {
    const html = `
      <script>
        const flashvars = {
          $id: 'x',
          'quoted': 1,
          empty: {},
          emptyList: [],
          list: [1, 'a', true, false, null, { k: 1 }, [2],],
          nested: { b: -1.5, z: 0 },
          flag: true,
          off: false,
          none: null,
          text: "line\\n\\r\\t\\"\\'\\\\\\/\\u0041\\x",
        };
      </script>
    `;

    expect(parseFlashvarsFromHtml(html)).toEqual({
      $id: 'x',
      quoted: 1,
      empty: {},
      emptyList: [],
      list: [1, 'a', true, false, null, { k: 1 }, [2]],
      nested: { b: -1.5, z: 0 },
      flag: true,
      off: false,
      none: null,
      text: 'line\n\r\t"\'\\/Ax',
    });
  });

  it('keeps braces that appear inside strings', () => {
    expect(parseFlashvarsFromHtml('<script>let flashvars = { a: " { } " };</script>')).toEqual({ a: ' { } ' });
  });

  it('rejects unbalanced, leftover, and invalid literals', () => {
    expect(() => parseFlashvarsFromHtml('<script>var flashvars = { a: 1</script>')).toThrow('flashvars not found');
    expect(() => parseFlashvarsFromHtml('<script>var flashvars = { 1bad: 1 }</script>')).toThrow('flashvars not found');
    expect(() => parseFlashvarsFromHtml('<script>var flashvars = { a: - }</script>')).toThrow('flashvars not found');
    expect(() => parseFlashvarsFromHtml('<script>var flashvars = { a: 0. }</script>')).toThrow('flashvars not found');
    expect(() => parseFlashvarsFromHtml('<script>var flashvars = { a: trueX }</script>')).toThrow('flashvars not found');
    expect(() => parseFlashvarsFromHtml('<script>var flashvars = { a: "unterminated }</script>')).toThrow(
      'flashvars not found',
    );
    expect(() => parseFlashvarsFromHtml('<script>var flashvars = { a: [1 }</script>')).toThrow('flashvars not found');
    expect(() => parseFlashvarsFromHtml('<script>var flashvars = { a 1 }</script>')).toThrow('flashvars not found');
    expect(() => parseFlashvarsFromHtml('<script>var flashvars = { a: 1 b: 2 }</script>')).toThrow('flashvars not found');
    expect(() => parseFlashvarsFromHtml('<script>var flashvars = { a: "\\uZZZZ" }</script>')).toThrow(
      'flashvars not found',
    );
    expect(() => parseFlashvarsFromHtml('<script>var flashvars = { a: "\\</script>')).toThrow('flashvars not found');
    expect(() => parseFlashvarsFromHtml('<script>var flashvars = { a: [1 2] }</script>')).toThrow('flashvars not found');
    expect(() => parseFlashvarsFromHtml('<script>var flashvars = { : 1 }</script>')).toThrow('flashvars not found');
    expect(() => parseFlashvarsFromHtml('<script>var flashvars = { a: [1,</script>')).toThrow('flashvars not found');
  });

  it('covers parser edge cases that HTML extraction cannot reach', () => {
    expect(extractBalancedObject('x', 0)).toBeNull();
    expect(() => new FlashvarsLiteralParser('{ a: 1 } extra').parseRootObject()).toThrow('flashvars invalid');
    expect(() => new FlashvarsLiteralParser('[1]').parseRootObject()).toThrow('flashvars invalid');
    const parser = new FlashvarsLiteralParser('{ a: 1 }');
    expect(() => (parser as unknown as { parseString: () => string }).parseString()).toThrow('flashvars invalid');
    expect(() => new FlashvarsLiteralParser('{ a: "\\').parseRootObject()).toThrow('flashvars invalid');
    expect(() => new FlashvarsLiteralParser('{ a: "foo').parseRootObject()).toThrow('flashvars invalid');
    expect(() => new FlashvarsLiteralParser('{ a: 1,').parseRootObject()).toThrow('flashvars invalid');
    expect(() => new FlashvarsLiteralParser('{ a: [1,').parseRootObject()).toThrow('flashvars invalid');
  });
});

describe('XMDCentre (integration)', () => {
  let centre: XMDCentre;
  const searchKeyword = 'gynarchy';

  beforeAll(() => {
    const xmdURL = process.env.XMD;
    if (!xmdURL) {
      throw new Error('XMD env variable is required — add it to .env at the project root');
    }

    mockConfig.set('XMD', xmdURL);
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
          expect(item.thumbnailSrc).toHaveLength(5);
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

    it(
      'should accept an empty keyword and return an array',
      async () => {
        const results = await centre.search('');
        expect(Array.isArray(results)).toBe(true);
      },
      NETWORK_TIMEOUT,
    );

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

  describe('getURL()', () => {
    it('should reject empty URL with 400 Bad Request', async () => {
      await expect(centre.getURL('')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should reject invalid URL format with 400 Bad Request', async () => {
      await expect(centre.getURL('not-a-url')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
