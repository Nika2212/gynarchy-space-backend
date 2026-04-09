require('dotenv').config();

import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { XMDCentre } from './XMD.centre';

const mockConfig = new Map<string, string>();

function createConfigServiceMock(): ConfigService {
  return { get: (key: string) => mockConfig.get(key) } as ConfigService;
}

const NETWORK_TIMEOUT = 30_000;

describe('XMDCentre (integration)', () => {
  let centre: XMDCentre;
  const searchKeyword = 'gynarchy';

  beforeAll(() => {
    const xmdUrl = process.env.XMD;
    if (!xmdUrl) {
      throw new Error('XMD env variable is required — add it to .env at the project root');
    }

    if (!process.env.CRYPTA) {
      process.env.CRYPTA = 'integration-test-url-token-secret-key';
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

  /**
   * Live `getUrl` needs a watch URL the origin serves. Search currently returns `/media/{token}` tokens;
   * resolving those over HTTP may 404 until the server maps tokens → real routes. Validation-only tests stay on.
   */
  describe('getUrl()', () => {
    it('should reject empty URL with 400 Bad Request', async () => {
      await expect(centre.getUrl('')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should reject invalid URL format with 400 Bad Request', async () => {
      await expect(centre.getUrl('not-a-url')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
