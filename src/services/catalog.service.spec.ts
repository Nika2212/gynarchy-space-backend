import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CatalogRepository } from '../repositories/catalog.repository';
import { PER_PAGE_SIZE } from '../shared/paging';
import { decryptShortTokenToURL } from '../shared/url-token';
import { CatalogService } from './catalog.service';

const BASES: Record<string, string | undefined> = {
  XMD: 'https://xmd.test',
  HF: 'https://hf.test',
  FVC: 'https://fvc.test',
};

function tokenURL(path: string): string {
  return decryptShortTokenToURL(path.split('/').pop() ?? '') ?? '';
}

describe('CatalogService', () => {
  let service: CatalogService;
  let search: jest.Mock;

  beforeEach(async () => {
    search = jest.fn().mockResolvedValue([]);
    service = await create(BASES);
  });

  async function create(bases: Record<string, string | undefined>): Promise<CatalogService> {
    const module = await Test.createTestingModule({
      providers: [CatalogService, { provide: CatalogRepository, useValue: { search } }, { provide: ConfigService, useValue: { get: (key: string) => bases[key] } }],
    }).compile();

    return module.get(CatalogService);
  }

  it('browses the newest videos for a missing or blank keyword', async () => {
    await expect(service.search({ keyword: undefined as unknown as string, page: 1, sort: '', filter: '' })).resolves.toEqual({
      medias: [],
      meta: { currentPage: 1, isLastPage: true },
    });
    await service.search({ keyword: null as unknown as string, page: 2, sort: '', filter: '' });
    await service.search({ keyword: '   ', page: 1, sort: '', filter: '' });

    expect(search).toHaveBeenNthCalledWith(1, [], 1, false);
    expect(search).toHaveBeenNthCalledWith(2, [], 2, false);
    expect(search).toHaveBeenNthCalledWith(3, [], 1, false);
  });

  it('searches the cleaned keyword and marks a full page as not last', async () => {
    search.mockResolvedValue(Array.from({ length: PER_PAGE_SIZE }, () => ({ _id: 'skip' })));

    const page = await service.search({ keyword: '  -latex   "mistress"\\ ', page: 4, sort: '', filter: '' });

    expect(search).toHaveBeenCalledWith(['latex', 'mistress'], 4, false);
    expect(page.medias).toEqual([]);
    expect(page.meta).toEqual({ currentPage: 4, isLastPage: false });
  });

  it('returns an empty page when the keyword has no searchable terms', async () => {
    const page = await service.search({ keyword: ' --- "" ', page: 1, sort: '', filter: '' });

    expect(search).not.toHaveBeenCalled();
    expect(page).toEqual({ medias: [], meta: { currentPage: 1, isLastPage: true } });
  });

  it('rejects a keyword that is not a string or is too long, and a page outside 1..1000', async () => {
    const query = { keyword: 'k', page: 1, sort: '', filter: '' };

    await expect(service.search({ ...query, keyword: 1 as unknown as string })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.search({ ...query, keyword: 'x'.repeat(201) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.search({ ...query, page: 0 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.search({ ...query, page: 1.5 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.search({ ...query, page: 1001 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rebuilds media cards from catalog rows for each site', async () => {
    search.mockResolvedValue([
      { _id: 1_000_016_971, s: 'xmd-clip', n: ' XMD ', d: 90, x: 'about', c: 2 },
      { _id: { toNumber: () => 2_000_131_503 }, s: 'hf-clip', n: 'HF', t: 3, p: '27/abc', d: Number.NaN, x: 1 },
      { _id: 3_000_033_018, s: 'fvc clip', n: 1, d: 0, u: 'https://cdn.test/odd.jpg' },
      { _id: 1_000_000_000, s: 'zero', n: 'no video id' },
      { _id: 4_000_000_001, s: 'other', n: 'unknown site' },
      { _id: 'bad', s: 'bad', n: 'bad id' },
      {
        _id: {
          toNumber: () => {
            throw new Error('overflow');
          },
        },
        s: 'bad',
        n: 'bad long',
      },
      { _id: 1.5, s: 'bad', n: 'fraction' },
      { _id: 1_000_000_002, s: '   ', n: 'blank slug' },
      { _id: 2_000_000_010, s: 'hf-bad', n: 'bad preview', p: 'nope' },
      { _id: 2_000_000_011, s: 'hf-cover', n: 'bad cover', u: 'http://%' },
    ]);

    const page = await service.search({ keyword: 'clip', page: 1, sort: '', filter: '' });

    expect(page.medias).toHaveLength(4);

    const [xmd, hf, fvc] = page.medias;
    expect(xmd).toMatchObject({ title: 'XMD', description: 'about', duration: 90_000, source: 'xmd', postedAt: '' });
    expect(tokenURL(xmd.url.replace('/media/', ''))).toBe('https://xmd.test/videos/xmd-clip/');
    expect(xmd.thumbnailSrc.map(tokenURL)).toEqual(['https://xmd.test/contents/videos_sources/16000/16971/screenshots/1.jpg', 'https://xmd.test/contents/videos_sources/16000/16971/screenshots/2.jpg']);

    expect(hf).toMatchObject({ title: 'HF', description: '', duration: 0, source: 'hf' });
    expect(hf.thumbnailSrc.map(tokenURL)).toEqual(['https://hf.test/contents/videos_screenshots/131000/131503/800x450/3.jpg']);
    expect(tokenURL(hf.previewSrc ?? '')).toBe('https://hf.test/get_file/27/abc/131000/131503/131503_preview.mp4/');

    expect(fvc).toMatchObject({ title: '', description: '', duration: 0, source: 'fvc' });
    expect(tokenURL(fvc.url.replace('/media/', ''))).toBe('https://fvc.test/video/33018/fvc%20clip/');
    expect(fvc.thumbnailSrc.map(tokenURL)).toEqual(['https://cdn.test/odd.jpg']);
    expect(fvc.previewSrc).toBeUndefined();
    expect(page.medias[3]).toMatchObject({ title: 'bad preview', source: 'hf' });
    expect(page.medias[3].previewSrc).toBeUndefined();
  });

  it('uses five screenshots when the count is missing and skips a site with no base URL', async () => {
    search.mockResolvedValue([
      { _id: 1_000_000_005, s: 'plain', n: 'Plain' },
      { _id: 2_000_000_008, s: 'hidden', n: 'Hidden', p: '1/ab' },
    ]);
    const limited = await create({ ...BASES, HF: 'not a url', FVC: undefined });

    const page = await limited.search({ keyword: 'plain', page: 1, sort: '', filter: '' });

    expect(page.medias).toHaveLength(1);
    expect(page.medias[0].thumbnailSrc).toHaveLength(5);
    expect(page.medias[0].thumbnailSrc.map(tokenURL)[0]).toBe('https://xmd.test/contents/videos_sources/0/5/screenshots/1.jpg');
    expect(page.medias[0].previewSrc).toBeUndefined();
  });
});
