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
  const execFindOne = jest.fn();
  const create = jest.fn();
  const bulkWrite = jest.fn();
  const select = jest.fn(() => ({ exec: execFind }));
  const find = jest.fn(() => ({ select }));
  const findOne = jest.fn(() => ({ exec: execFindOne }));

  beforeEach(async () => {
    execFind.mockReset();
    execFindOne.mockReset();
    create.mockReset();
    bulkWrite.mockReset();

    const module = await Test.createTestingModule({
      providers: [
        MediaRepository,
        { provide: ConfigService, useValue: { getOrThrow: () => SECRET } },
        {
          provide: getModelToken(MediaDocument.name),
          useValue: { find, findOne, create, bulkWrite },
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
});
