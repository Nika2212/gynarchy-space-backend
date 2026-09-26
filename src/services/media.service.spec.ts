import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PER_PAGE_SIZE, XMDCentre } from '../core/centres/XMD.centre';
import { MediaRepository } from '../repositories/media.repository';
import type { IMediaInfo } from '../shared/interfaces/media-info.interface';
import { encryptURLToShortToken } from '../shared/url-token';
import { MediaService } from './media.service';

function mockMedia(overrides: Partial<IMediaInfo> = {}): IMediaInfo {
  return {
    title: 't',
    url: '/watch/x',
    thumbnailSrc: ['/1.jpg', '/2.jpg', '/3.jpg', '/4.jpg', '/5.jpg', '/6.jpg'],
    description: '',
    postedAt: '',
    duration: 0,
    ...overrides,
  };
}

describe('MediaService', () => {
  let service: MediaService;
  let search: jest.Mock;
  let findByIdentifiers: jest.Mock;
  let findByFlag: jest.Mock;
  let upsertFromSearch: jest.Mock;
  let toggleLike: jest.Mock;
  let toggleFavorite: jest.Mock;
  let toggleHidden: jest.Mock;
  let saveWatchPosition: jest.Mock;

  beforeEach(async () => {
    search = jest.fn();
    findByIdentifiers = jest.fn().mockResolvedValue([]);
    findByFlag = jest.fn().mockResolvedValue({ medias: [], total: 0 });
    upsertFromSearch = jest.fn().mockResolvedValue(undefined);
    toggleLike = jest.fn().mockResolvedValue({ isLiked: true });
    toggleFavorite = jest.fn().mockResolvedValue({ isFavorite: true });
    toggleHidden = jest.fn().mockResolvedValue({ isHidden: true });
    saveWatchPosition = jest.fn().mockResolvedValue({ watchPositionAt: 12 });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaService,
        {
          provide: XMDCentre,
          useValue: { search },
        },
        {
          provide: MediaRepository,
          useValue: {
            findByIdentifiers,
            findByFlag,
            upsertFromSearch,
            toggleLike,
            toggleFavorite,
            toggleHidden,
            saveWatchPosition,
          },
        },
      ],
    }).compile();

    service = module.get(MediaService);
  });

  it('findAll forwards keyword and page to XMDCentre.search', async () => {
    search.mockResolvedValue([]);
    await service.findAll({
      keyword: 'alpha',
      page: 3,
      sort: '',
      filter: '',
    });

    expect(search).toHaveBeenCalledWith('alpha', 3);
  });

  it('findAll sets isLastPage true when result count is below PER_PAGE_SIZE', async () => {
    search.mockResolvedValue(Array.from({ length: PER_PAGE_SIZE - 1 }, () => mockMedia()));
    const out = await service.findAll({
      keyword: 'k',
      page: 1,
      sort: '',
      filter: '',
    });

    expect(out.medias).toHaveLength(PER_PAGE_SIZE - 1);
    expect(out.meta).toEqual({
      currentPage: 1,
      isLastPage: true,
    });
  });

  it('findAll sets isLastPage false when result count equals PER_PAGE_SIZE', async () => {
    search.mockResolvedValue(Array.from({ length: PER_PAGE_SIZE }, () => mockMedia()));
    const out = await service.findAll({
      keyword: 'k',
      page: 2,
      sort: '',
      filter: '',
    });

    expect(out.medias).toHaveLength(PER_PAGE_SIZE);
    expect(out.meta).toEqual({
      currentPage: 2,
      isLastPage: false,
    });
  });

  it('propagates errors from XMDCentre.search', async () => {
    search.mockRejectedValue(new Error('upstream'));
    await expect(service.findAll({ keyword: 'k', page: 1, sort: '', filter: '' })).rejects.toThrow(
      'upstream',
    );
  });

  it('propagates BadRequestException from XMDCentre.search', async () => {
    search.mockRejectedValue(new BadRequestException('Invalid keyword'));
    await expect(
      service.findAll({ keyword: '', page: 1, sort: '', filter: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('merges stored flags for identified media and defaults the rest', async () => {
    search.mockResolvedValue([
      mockMedia({ identifier: 'id-1' }),
      mockMedia({ title: 'no-id' }),
    ]);
    findByIdentifiers.mockResolvedValue([
      {
        identifier: 'id-1',
        isLiked: true,
        isFavorite: true,
        isHidden: true,
        watchedAt: new Date('2026-01-01'),
        watchedTimes: 3,
        watchPositionAt: 12,
      },
    ]);

    const out = await service.findAll({ keyword: 'k', page: 1, sort: '', filter: '' });

    expect(upsertFromSearch).toHaveBeenCalled();
    expect(out.medias[0]).toMatchObject({
      identifier: 'id-1',
      isLiked: true,
      isFavorite: true,
      isHidden: true,
      watchedTimes: 3,
      watchPositionAt: 12,
    });
    expect(out.medias[1]).toMatchObject({
      isLiked: false,
      isFavorite: false,
      isHidden: false,
      watchedTimes: 0,
    });
  });

  it('findLiked and findFavorites return stored pages with search-shaped meta', async () => {
    const liked = [mockMedia({ identifier: 'liked-1', isLiked: true })];
    findByFlag.mockResolvedValueOnce({ medias: liked, total: PER_PAGE_SIZE + 1 });

    await expect(service.findLiked(1)).resolves.toEqual({
      medias: liked,
      meta: { currentPage: 1, isLastPage: false },
    });
    expect(findByFlag).toHaveBeenCalledWith('isLiked', 1);

    findByFlag.mockResolvedValueOnce({ medias: [], total: 0 });
    await expect(service.findFavorites(0)).resolves.toEqual({
      medias: [],
      meta: { currentPage: 1, isLastPage: true },
    });
    expect(findByFlag).toHaveBeenCalledWith('isFavorite', 1);
  });

  it('toggles flags only for a valid media token', async () => {
    const id = encryptURLToShortToken('https://example.com/v');

    await expect(service.toggleLike(id)).resolves.toEqual({ isLiked: true });
    await expect(service.toggleFavorite(id)).resolves.toEqual({ isFavorite: true });
    await expect(service.toggleHidden(id)).resolves.toEqual({ isHidden: true });
    await expect(service.toggleLike('')).rejects.toThrow('Invalid media id');
    await expect(service.toggleFavorite('nope')).rejects.toThrow('Invalid media id');
  });

  it('saves watch position only for a valid media token and non-negative finite value', async () => {
    const id = encryptURLToShortToken('https://example.com/v');

    await expect(service.saveWatchPosition(id, 12_000)).resolves.toEqual({ watchPositionAt: 12 });
    expect(saveWatchPosition).toHaveBeenCalledWith(id, 12_000);
    await expect(service.saveWatchPosition('', 1)).rejects.toThrow('Invalid media id');
    await expect(service.saveWatchPosition(id, -1)).rejects.toThrow('Invalid watchPositionAt');
    await expect(service.saveWatchPosition(id, Number.NaN)).rejects.toThrow('Invalid watchPositionAt');
    await expect(service.saveWatchPosition(id, Number.POSITIVE_INFINITY)).rejects.toThrow(
      'Invalid watchPositionAt',
    );
  });
});
