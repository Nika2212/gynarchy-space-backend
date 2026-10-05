import { CentreRegistry } from '../core/centres/centre.registry';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { IMediaSnapshot } from '../shared/interfaces/media-snapshot.interface';
import { encryptURLToShortToken } from '../shared/url-token';
import { MediaRepository } from './media.repository';
import { MediaDocument } from './media.schema';

const SNAPSHOT: IMediaSnapshot = {
  title: 'Title',
  duration: 61_000,
  postedAt: '2 days ago',
  thumbnailSrc: ['/images/a', '/images/b'],
};

function storedRow(identifier: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    identifier,
    title: 'Stored',
    description: '',
    postedAt: '',
    thumbnailSrc: '[]',
    duration: 0,
    isLiked: false,
    isFavorite: false,
    isDownloaded: false,
    watchedAt: null,
    watchedTimes: 0,
    watchPositionAt: null,
    save: jest.fn(),
    ...overrides,
  };
}

describe('MediaRepository', () => {
  let repository: MediaRepository;
  const execFind = jest.fn();
  const execFindOne = jest.fn();
  const execDelete = jest.fn();
  const sort = jest.fn(() => ({ exec: execFind }));
  const find = jest.fn(() => ({ sort }));
  const findOne = jest.fn(() => ({ exec: execFindOne }));
  const deleteOne = jest.fn(() => ({ exec: execDelete }));
  const deleteMany = jest.fn(() => ({ exec: execDelete }));
  const updateMany = jest.fn(() => ({ exec: execDelete }));
  const create = jest.fn();

  beforeEach(async () => {
    [execFind, execFindOne, execDelete, sort, find, findOne, deleteOne, deleteMany, updateMany, create].forEach((mock) => mock.mockClear());
    execFind.mockReset();
    execFindOne.mockReset();
    create.mockReset();
    create.mockImplementation(async (doc: Record<string, unknown>) => doc);

    const module = await Test.createTestingModule({
      providers: [
        MediaRepository,
        { provide: CentreRegistry, useValue: { findByURL: () => ({ source: 'xmd' }) } },
        {
          provide: getModelToken(MediaDocument.name),
          useValue: { find, findOne, deleteOne, deleteMany, updateMany, create },
        },
      ],
    }).compile();

    repository = module.get(MediaRepository);
  });

  it('loads the library with flags, skips rows without an identifier, and parses thumbnails', async () => {
    execFind.mockResolvedValue([
      storedRow('a', {
        isLiked: true,
        likedAt: new Date('2026-02-02'),
        isDownloaded: undefined,
        thumbnailSrc: '["/images/a"]',
        watchedAt: new Date('2026-01-01'),
        watchPositionAt: 5_000,
        watchedTimes: undefined,
        duration: undefined,
      }),
      storedRow('b', { thumbnailSrc: '{"not":"array"}', title: undefined, description: undefined, postedAt: undefined }),
      storedRow('c', { thumbnailSrc: 'not json' }),
      storedRow('d', { thumbnailSrc: '' }),
      storedRow('e', { identifier: '' }),
    ]);

    const library = await repository.findLibrary();

    expect(find).toHaveBeenCalledWith({
      $or: [{ isLiked: true }, { isFavorite: true }, { isDownloaded: true }, { watchPositionAt: { $ne: null } }],
    });
    expect(sort).toHaveBeenCalledWith({ updatedAt: -1 });
    expect(library.map((media) => media.identifier)).toEqual(['a', 'b', 'c', 'd']);
    expect(library[0]).toMatchObject({
      url: '/media/a',
      title: 'Stored',
      thumbnailSrc: ['/images/a'],
      isLiked: true,
      isDownloaded: false,
      watchPositionAt: 5_000,
      watchedTimes: 0,
      duration: 0,
      likedAt: new Date('2026-02-02'),
      favoritedAt: undefined,
    });
    expect(library[1]).toMatchObject({ title: '', description: '', postedAt: '', thumbnailSrc: [], watchedAt: undefined, watchPositionAt: undefined });
    expect(library[2].thumbnailSrc).toEqual([]);
    expect(library[3].thumbnailSrc).toEqual([]);
  });

  it('creates a liked row with the card when the media is new', async () => {
    const id = encryptURLToShortToken('https://example.com/v');
    execFindOne.mockResolvedValue(null);

    await expect(repository.toggleLike(id, SNAPSHOT)).resolves.toMatchObject({ identifier: id, isLiked: true, isFavorite: false });

    const stored = create.mock.calls[0][0];
    expect(stored).toMatchObject({
      identifier: id,
      isLiked: true,
      likedAt: expect.any(Date),
      duration: 61_000,
      title: 'Title',
      url: 'https://example.com/v',
      source: 'xmd',
    });
    expect(JSON.parse(stored.thumbnailSrc)).toEqual(['/images/a', '/images/b']);
    expect(stored).not.toHaveProperty('identifierHash');
  });

  it('falls back to a media path when the identifier is not a URL token', async () => {
    execFindOne.mockResolvedValue(null);

    await repository.toggleFavorite('raw-id', SNAPSHOT);

    expect(create.mock.calls[0][0].url).toBe('/media/raw-id');
    expect(create.mock.calls[0][0]).toMatchObject({ isFavorite: true, favoritedAt: expect.any(Date) });
  });

  it('flips a flag on an existing row, refreshes its card, and keeps it while something is left', async () => {
    const row = storedRow('raw-id', { isLiked: false, isFavorite: true });
    execFindOne.mockResolvedValue(row);

    await expect(repository.toggleLike('raw-id', SNAPSHOT)).resolves.toMatchObject({ isLiked: true, isFavorite: true });

    expect(row.likedAt).toEqual(expect.any(Date));
    expect(row.title).toBe('Title');
    expect(row.save).toHaveBeenCalled();
    expect(deleteOne).not.toHaveBeenCalled();
  });

  it('deletes the row once no flag or watch progress is left', async () => {
    const row = storedRow('raw-id', { isLiked: true });
    execFindOne.mockResolvedValue(row);

    await expect(repository.toggleLike('raw-id', SNAPSHOT)).resolves.toMatchObject({ identifier: 'raw-id', isLiked: false });

    expect(row.likedAt).toBeNull();
    expect(deleteOne).toHaveBeenCalledWith({ identifier: 'raw-id' });
    expect(row.save).not.toHaveBeenCalled();
  });

  it('keeps an unflagged row that still has watch progress or is downloaded', async () => {
    const watched = storedRow('w', { isFavorite: true, watchPositionAt: 1_000 });
    execFindOne.mockResolvedValueOnce(watched);
    await repository.toggleFavorite('w', SNAPSHOT);
    expect(watched.save).toHaveBeenCalled();

    const downloaded = storedRow('d', { isLiked: true, isDownloaded: true });
    execFindOne.mockResolvedValueOnce(downloaded);
    await repository.toggleLike('d', SNAPSHOT);
    expect(downloaded.save).toHaveBeenCalled();
    expect(deleteOne).not.toHaveBeenCalled();
  });

  it('creates a row when saving watch position for a new media', async () => {
    const id = encryptURLToShortToken('https://example.com/v');
    execFindOne.mockResolvedValue(null);

    await expect(repository.saveWatchPosition(id, 15_000, SNAPSHOT)).resolves.toMatchObject({ identifier: id, watchPositionAt: 15_000, watchedAt: expect.any(Date) });
    expect(create.mock.calls[0][0]).toMatchObject({ watchPositionAt: 15_000, isLiked: false, watchedTimes: 1 });
  });

  it('updates watch position, watched time, and card on an existing row', async () => {
    const row = storedRow('raw-id', { isDownloaded: undefined, watchedTimes: undefined, watchedAt: undefined, watchPositionAt: undefined });
    execFindOne.mockResolvedValue(row);

    await expect(repository.saveWatchPosition('raw-id', 4_500, SNAPSHOT)).resolves.toMatchObject({
      identifier: 'raw-id',
      isDownloaded: false,
      watchedTimes: 1,
      watchPositionAt: 4_500,
      watchedAt: expect.any(Date),
    });
    expect(row.postedAt).toBe('2 days ago');
    expect(row.save).toHaveBeenCalled();
  });

  it('counts a new viewing only after a long gap since the last save', async () => {
    const recent = storedRow('r', { watchedAt: new Date(Date.now() - 60_000), watchedTimes: 2, watchPositionAt: 1_000 });
    execFindOne.mockResolvedValueOnce(recent);
    await expect(repository.saveWatchPosition('r', 2_000, SNAPSHOT)).resolves.toMatchObject({ watchedTimes: 2 });

    const old = storedRow('o', { watchedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), watchedTimes: 2, watchPositionAt: 1_000 });
    execFindOne.mockResolvedValueOnce(old);
    await expect(repository.saveWatchPosition('o', 2_000, SNAPSHOT)).resolves.toMatchObject({ watchedTimes: 3 });
  });

  it('clears one media from the watch history and deletes it when nothing else is left', async () => {
    execFindOne.mockResolvedValueOnce(null);
    await expect(repository.clearWatchHistory('missing')).resolves.toBeNull();

    const historyOnly = storedRow('h', { watchedAt: new Date(), watchedTimes: 3, watchPositionAt: 9_000 });
    execFindOne.mockResolvedValueOnce(historyOnly);
    await expect(repository.clearWatchHistory('h')).resolves.toMatchObject({ identifier: 'h', watchedAt: null, watchedTimes: 0, watchPositionAt: null });
    expect(deleteOne).toHaveBeenCalledWith({ identifier: 'h' });

    const liked = storedRow('l', { isLiked: true, watchedAt: new Date(), watchedTimes: 1, watchPositionAt: 9_000 });
    execFindOne.mockResolvedValueOnce(liked);
    await expect(repository.clearWatchHistory('l')).resolves.toMatchObject({ isLiked: true, watchPositionAt: null });
    expect(liked.save).toHaveBeenCalled();
    expect(deleteOne).toHaveBeenCalledTimes(1);
  });

  it('clears the whole watch history but keeps flagged media', async () => {
    await repository.clearAllWatchHistory();

    expect(deleteMany).toHaveBeenCalledWith({ isLiked: false, isFavorite: false, isDownloaded: false });
    expect(updateMany).toHaveBeenCalledWith({ watchedAt: { $ne: null } }, { watchedAt: null, watchedTimes: 0, watchPositionAt: null });
  });

  it('looks rows up by their identifier', async () => {
    execFindOne.mockResolvedValue(null);
    await repository.findDownloadSize('raw-id');
    expect(findOne).toHaveBeenCalledWith({ identifier: 'raw-id', isDownloaded: true });
  });

  it('returns undefined flags for a stored row without an identifier', async () => {
    create.mockImplementation(async (doc: Record<string, unknown>) => ({ ...doc, identifier: '' }));
    execFindOne.mockResolvedValue(null);

    await expect(repository.toggleLike('raw-id', SNAPSHOT)).resolves.toBeUndefined();
  });
});
