import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { encryptText } from '../shared/field-crypto';
import { encryptURLToShortToken } from '../shared/url-token';
import { MediaRepository } from './media.repository';
import { MediaDocument } from './media.schema';

const SECRET = 'jwt-secret';

describe('MediaRepository', () => {
  let repository: MediaRepository;
  const execFind = jest.fn();
  const execFindFlagged = jest.fn();
  const execCount = jest.fn();
  const execFindOne = jest.fn();
  const create = jest.fn();
  const bulkWrite = jest.fn();
  const select = jest.fn(() => ({ exec: execFind }));
  const limit = jest.fn(() => ({ exec: execFindFlagged }));
  const skip = jest.fn(() => ({ limit }));
  const sort = jest.fn(() => ({ skip }));
  const find = jest.fn(() => ({ select, sort }));
  const findOne = jest.fn(() => ({ exec: execFindOne }));
  const countDocuments = jest.fn(() => ({ exec: execCount }));

  beforeEach(async () => {
    execFind.mockReset();
    execFindFlagged.mockReset();
    execCount.mockReset();
    execFindOne.mockReset();
    create.mockReset();
    bulkWrite.mockReset();

    const module = await Test.createTestingModule({
      providers: [
        MediaRepository,
        { provide: ConfigService, useValue: { getOrThrow: () => SECRET } },
        {
          provide: getModelToken(MediaDocument.name),
          useValue: { find, findOne, create, bulkWrite, countDocuments },
        },
      ],
    }).compile();

    repository = module.get(MediaRepository);
  });

  it('returns no flags when the identifier list is empty', async () => {
    await expect(repository.findByIdentifiers([])).resolves.toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });

  it('decrypts matching rows and skips corrupt identifiers', async () => {
    const identifier = 'abc';
    execFind.mockResolvedValue([
      {
        identifier: encryptText(identifier, SECRET),
        isLiked: true,
        isFavorite: false,
        isHidden: true,
      },
      {
        identifier: 'not-cipher',
        isLiked: false,
        isFavorite: false,
        isHidden: false,
      },
    ]);

    await expect(repository.findByIdentifiers([identifier])).resolves.toEqual([
      {
        identifier,
        isLiked: true,
        isFavorite: false,
        isHidden: true,
        watchedAt: null,
        watchedTimes: 0,
        watchPositionAt: null,
      },
    ]);
  });

  it('skips upsert when no media has an identifier', async () => {
    await repository.upsertFromSearch([{ title: 'x', url: '/x', thumbnailSrc: [], description: '', postedAt: '', duration: 1 }]);
    expect(bulkWrite).not.toHaveBeenCalled();
  });

  it('bulk-upserts catalog fields including optional blanks', async () => {
    await repository.upsertFromSearch([
      {
        identifier: 'id-1',
        title: 't',
        url: '/u',
        thumbnailSrc: ['a'],
        description: 'd',
        postedAt: 'now',
        duration: 9,
      },
      {
        identifier: 'id-2',
        title: 't2',
        url: '/u2',
      } as never,
    ]);

    expect(bulkWrite).toHaveBeenCalledWith(expect.any(Array), { ordered: false });
    expect(bulkWrite.mock.calls[0][0]).toHaveLength(2);
  });

  it('creates a row when toggling a missing media item', async () => {
    const id = encryptURLToShortToken('https://example.com/v');
    execFindOne.mockResolvedValue(null);
    create.mockResolvedValue({
      identifier: encryptText(id, SECRET),
      isLiked: true,
      isFavorite: false,
      isHidden: false,
      watchedAt: null,
      watchedTimes: 0,
      watchPositionAt: null,
    });

    await expect(repository.toggleLike(id)).resolves.toMatchObject({ identifier: id, isLiked: true });
    expect(create).toHaveBeenCalled();
  });

  it('creates from a non-decodable identifier and flips existing flags', async () => {
    execFindOne.mockResolvedValueOnce(null);
    create.mockResolvedValue({
      identifier: encryptText('raw-id', SECRET),
      isLiked: false,
      isFavorite: true,
      isHidden: false,
    });
    await repository.toggleFavorite('raw-id');

    const save = jest.fn();
    execFindOne.mockResolvedValue({
      isHidden: false,
      identifier: encryptText('raw-id', SECRET),
      isLiked: false,
      isFavorite: false,
      save,
    });
    await expect(repository.toggleHidden('raw-id')).resolves.toMatchObject({ isHidden: true });
    expect(save).toHaveBeenCalled();
  });

  it('creates a row when saving watch position for a missing media item', async () => {
    const id = encryptURLToShortToken('https://example.com/v');
    execFindOne.mockResolvedValue(null);
    create.mockResolvedValue({
      identifier: encryptText(id, SECRET),
      isLiked: false,
      isFavorite: false,
      isHidden: false,
      watchedAt: new Date('2026-01-01'),
      watchedTimes: 0,
      watchPositionAt: 15_000,
    });

    await expect(repository.saveWatchPosition(id, 15_000)).resolves.toMatchObject({
      identifier: id,
      watchPositionAt: 15_000,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        watchPositionAt: 15_000,
        watchedAt: expect.any(Date),
      }),
    );
  });

  it('updates watch position and watchedAt on an existing media item', async () => {
    const save = jest.fn();
    execFindOne.mockResolvedValue({
      identifier: encryptText('raw-id', SECRET),
      isLiked: false,
      isFavorite: false,
      isHidden: false,
      watchedAt: null,
      watchedTimes: 0,
      watchPositionAt: null,
      save,
    });

    await expect(repository.saveWatchPosition('raw-id', 4_500)).resolves.toMatchObject({
      identifier: 'raw-id',
      watchPositionAt: 4_500,
      watchedAt: expect.any(Date),
    });
    expect(save).toHaveBeenCalled();
  });

  it('decrypts flagged catalog rows and skips corrupt identifiers', async () => {
    const identifier = encryptURLToShortToken('https://example.com/v');
    execFindFlagged.mockResolvedValue([
      {
        identifier: encryptText(identifier, SECRET),
        title: encryptText('Title', SECRET),
        description: encryptText('Desc', SECRET),
        postedAt: encryptText('now', SECRET),
        thumbnailSrc: encryptText(JSON.stringify(['/images/a']), SECRET),
        duration: 9,
        isLiked: true,
        isFavorite: false,
        isHidden: false,
        watchedAt: new Date('2026-01-01'),
        watchedTimes: 2,
        watchPositionAt: 100,
      },
      {
        identifier: 'not-cipher',
        isLiked: true,
      },
    ]);
    execCount.mockResolvedValue(2);

    await expect(repository.findByFlag('isLiked', 2)).resolves.toEqual({
      medias: [
        {
          identifier,
          url: `/media/${identifier}`,
          title: 'Title',
          description: 'Desc',
          postedAt: 'now',
          duration: 9,
          thumbnailSrc: ['/images/a'],
          isLiked: true,
          isFavorite: false,
          isHidden: false,
          watchedAt: new Date('2026-01-01'),
          watchedTimes: 2,
          watchPositionAt: 100,
        },
      ],
      total: 2,
    });
    expect(find).toHaveBeenCalledWith({ isLiked: true });
    expect(sort).toHaveBeenCalledWith({ updatedAt: -1 });
    expect(skip).toHaveBeenCalledWith(24);
    expect(limit).toHaveBeenCalledWith(24);
  });

  it('defaults catalog blanks and treats invalid thumbnail payloads as empty', async () => {
    const identifier = 'id-1';
    execFindFlagged.mockResolvedValue([
      {
        identifier: encryptText(identifier, SECRET),
        title: 'not-cipher',
        description: 'not-cipher',
        postedAt: 'not-cipher',
        thumbnailSrc: 'not-cipher',
        isLiked: false,
        isFavorite: true,
        isHidden: false,
      },
      {
        identifier: encryptText('id-2', SECRET),
        title: encryptText('t', SECRET),
        thumbnailSrc: encryptText('not-json', SECRET),
        isLiked: false,
        isFavorite: true,
        isHidden: false,
      },
      {
        identifier: encryptText('id-3', SECRET),
        title: encryptText('t', SECRET),
        thumbnailSrc: encryptText(JSON.stringify([1, 2]), SECRET),
        isLiked: false,
        isFavorite: true,
        isHidden: false,
      },
    ]);
    execCount.mockResolvedValue(3);

    const out = await repository.findByFlag('isFavorite', 1);

    expect(out.total).toBe(3);
    expect(out.medias[0]).toMatchObject({
      identifier,
      title: '',
      description: '',
      postedAt: '',
      duration: 0,
      thumbnailSrc: [],
      watchedTimes: 0,
    });
    expect(out.medias[1].thumbnailSrc).toEqual([]);
    expect(out.medias[2].thumbnailSrc).toEqual([]);
    expect(find).toHaveBeenCalledWith({ isFavorite: true });
  });
});
