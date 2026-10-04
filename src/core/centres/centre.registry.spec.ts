import { BadRequestException } from '@nestjs/common';
import type { IMediaInfo } from '../../shared/interfaces/media-info.interface';
import { PER_PAGE_SIZE } from '../../shared/paging';
import type { BaseCentre } from './base.centre';
import { CentreRegistry } from './centre.registry';

function card(identifier: string): IMediaInfo {
  return { identifier, title: identifier, url: `/media/${identifier}`, thumbnailSrc: [], description: '', postedAt: '', duration: 0 };
}

function centre(source: string, host: string, search: jest.Mock): BaseCentre {
  return {
    source,
    search,
    isAllowedAssetURL: (url: string) => new URL(url).hostname === host,
  } as unknown as BaseCentre;
}

describe('CentreRegistry', () => {
  let xmd: jest.Mock;
  let hf: jest.Mock;
  let registry: CentreRegistry;

  beforeEach(() => {
    xmd = jest.fn().mockResolvedValue([card('x1'), card('x2'), card('x3')]);
    hf = jest.fn().mockResolvedValue([card('h1')]);
    registry = new CentreRegistry([centre('xmd', 'x.test', xmd), centre('hf', 'h.test', hf)]);
  });

  it('searches every centre with the same query and interleaves the cards', async () => {
    const out = await registry.search('k', 2);

    expect(xmd).toHaveBeenCalledWith('k', 2);
    expect(hf).toHaveBeenCalledWith('k', 2);
    expect(out.medias.map((m) => m.identifier)).toEqual(['x1', 'h1', 'x2', 'x3']);
    expect(out.isLastPage).toBe(true);
  });

  it('is not the last page while any centre returns a full page', async () => {
    xmd.mockResolvedValue(Array.from({ length: PER_PAGE_SIZE }, (_, i) => card(`x${i}`)));

    await expect(registry.search('k', 1)).resolves.toMatchObject({ isLastPage: false });
  });

  it('drops repeated identifiers', async () => {
    hf.mockResolvedValue([card('x1'), card('h1')]);

    const out = await registry.search('k', 1);

    expect(out.medias.map((m) => m.identifier)).toEqual(['x1', 'x2', 'h1', 'x3']);
  });

  it('returns the healthy centres when one fails', async () => {
    hf.mockRejectedValue(new Error('down'));

    const out = await registry.search('k', 1);

    expect(out.medias.map((m) => m.identifier)).toEqual(['x1', 'x2', 'x3']);
  });

  it('throws the first error when every centre fails', async () => {
    xmd.mockRejectedValue(new BadRequestException('Invalid page'));
    hf.mockRejectedValue(new BadRequestException('Invalid page'));

    await expect(registry.search('k', 0)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('routes URLs to the centre that owns the host', () => {
    expect(registry.findByURL('https://h.test/videos/1')?.source).toBe('hf');
    expect(registry.findByURL('https://x.test/videos/1')?.source).toBe('xmd');
    expect(registry.findByURL('https://evil.test/')).toBeUndefined();
    expect(registry.isAllowedAssetURL('https://x.test/a.jpg')).toBe(true);
    expect(registry.isAllowedAssetURL('https://evil.test/a.jpg')).toBe(false);
  });
});
