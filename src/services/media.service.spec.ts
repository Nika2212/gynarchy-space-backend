import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { XMDCentre } from '../core/centres/XMD.centre';
import { PER_PAGE_SIZE } from '../shared/paging';
import { MediaRepository } from '../repositories/media.repository';
import type { IMediaInfo } from '../shared/interfaces/media-info.interface';
import type { IMediaSnapshot } from '../shared/interfaces/media-snapshot.interface';
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

const SNAPSHOT: IMediaSnapshot = {
  title: 't',
  duration: 1,
  postedAt: '',
  thumbnailSrc: [],
};

describe('MediaService', () => {
  let service: MediaService;
  let search: jest.Mock;
  let findLibrary: jest.Mock;
  let toggleLike: jest.Mock;
  let toggleFavorite: jest.Mock;
  let saveWatchPosition: jest.Mock;
  let clearWatchHistory: jest.Mock;
  let clearAllWatchHistory: jest.Mock;

  beforeEach(async () => {
    search = jest.fn();
    findLibrary = jest.fn().mockResolvedValue([mockMedia({ identifier: 'a', isLiked: true })]);
    toggleLike = jest.fn().mockResolvedValue({ isLiked: true });
    toggleFavorite = jest.fn().mockResolvedValue({ isFavorite: true });
    saveWatchPosition = jest.fn().mockResolvedValue({ watchPositionAt: 12 });
    clearWatchHistory = jest.fn().mockResolvedValue({ watchPositionAt: null });
    clearAllWatchHistory = jest.fn().mockResolvedValue(undefined);
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
            findLibrary,
            toggleLike,
            toggleFavorite,
            saveWatchPosition,
            clearWatchHistory,
            clearAllWatchHistory,
          },
        },
      ],
    }).compile();

    service = module.get(MediaService);
  });

  it('findAll returns the XMD page as-is with paging meta', async () => {
    const medias = [mockMedia({ identifier: 'x' })];
    search.mockResolvedValue(medias);

    await expect(service.findAll({ keyword: 'alpha', page: 2, sort: '', filter: '' })).resolves.toEqual({
      medias,
      meta: { currentPage: 2, isLastPage: true },
    });
    expect(search).toHaveBeenCalledWith('alpha', 2);
  });

  it('findAll sets isLastPage false for a full page', async () => {
    search.mockResolvedValue(Array.from({ length: PER_PAGE_SIZE }, () => mockMedia()));

    const out = await service.findAll({ keyword: 'k', page: 1, sort: '', filter: '' });

    expect(out.meta.isLastPage).toBe(false);
  });

  it('propagates errors from XMDCentre.search', async () => {
    search.mockRejectedValue(new BadRequestException('Invalid keyword'));

    await expect(service.findAll({ keyword: 'k', page: 1, sort: '', filter: '' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('findLibrary wraps the stored medias', async () => {
    await expect(service.findLibrary()).resolves.toEqual({ medias: [mockMedia({ identifier: 'a', isLiked: true })] });
  });

  it('toggles flags with the card only for a valid media token', async () => {
    const id = encryptURLToShortToken('https://example.com/v');

    await expect(service.toggleLike(id, SNAPSHOT)).resolves.toEqual({ isLiked: true });
    await expect(service.toggleFavorite(id, SNAPSHOT)).resolves.toEqual({ isFavorite: true });
    expect(toggleLike).toHaveBeenCalledWith(id, SNAPSHOT);
    expect(toggleFavorite).toHaveBeenCalledWith(id, SNAPSHOT);

    await expect(service.toggleLike('', SNAPSHOT)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.toggleFavorite('nope', SNAPSHOT)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('saves watch position only for a valid media token and non-negative finite value', async () => {
    const id = encryptURLToShortToken('https://example.com/v');

    await expect(service.saveWatchPosition(id, 12, SNAPSHOT)).resolves.toEqual({ watchPositionAt: 12 });
    expect(saveWatchPosition).toHaveBeenCalledWith(id, 12, SNAPSHOT);

    await expect(service.saveWatchPosition('nope', 12, SNAPSHOT)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.saveWatchPosition(id, -1, SNAPSHOT)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.saveWatchPosition(id, Number.NaN, SNAPSHOT)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clears one media from the watch history, or 404s for an invalid id or unknown media', async () => {
    const id = encryptURLToShortToken('https://example.com/v');

    await expect(service.clearWatchHistory(id)).resolves.toEqual({ watchPositionAt: null });
    expect(clearWatchHistory).toHaveBeenCalledWith(id);

    await expect(service.clearWatchHistory('nope')).rejects.toBeInstanceOf(NotFoundException);

    clearWatchHistory.mockResolvedValueOnce(null);
    await expect(service.clearWatchHistory(id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('clears the whole watch history', async () => {
    await expect(service.clearAllWatchHistory()).resolves.toBeUndefined();
    expect(clearAllWatchHistory).toHaveBeenCalled();
  });
});
