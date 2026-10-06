import { Logger } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { PER_PAGE_SIZE } from '../shared/paging';
import { CatalogRepository } from './catalog.repository';

describe('CatalogRepository', () => {
  let repository: CatalogRepository;
  const toArray = jest.fn();
  const limit = jest.fn(() => ({ toArray }));
  const skip = jest.fn(() => ({ limit }));
  const sort = jest.fn(() => ({ skip }));
  const find = jest.fn(() => ({ sort }));
  const createIndex = jest.fn();
  const collection = jest.fn(() => ({ find, createIndex }));

  beforeEach(async () => {
    [toArray, limit, skip, sort, find, createIndex, collection].forEach((mock) => mock.mockClear());
    toArray.mockResolvedValue([{ _id: 1 }]);

    const module = await Test.createTestingModule({
      providers: [CatalogRepository, { provide: getConnectionToken(), useValue: { collection } }],
    }).compile();

    repository = module.get(CatalogRepository);
  });

  it('ensures the catalog text index on start', async () => {
    createIndex.mockResolvedValue('catalog_text');

    await repository.onModuleInit();

    expect(collection).toHaveBeenCalledWith('catalog');
    expect(createIndex).toHaveBeenCalledWith({ n: 'text', m: 'text', k: 'text', g: 'text', s: 'text', x: 'text' }, { name: 'catalog_text', default_language: 'none', weights: { n: 10, m: 8, k: 6, g: 5, s: 3, x: 1 } });
  });

  it('logs a failed index build without stopping startup', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    createIndex.mockRejectedValueOnce(new Error('not authorized')).mockRejectedValueOnce('nope');

    await expect(repository.onModuleInit()).resolves.toBeUndefined();
    await expect(repository.onModuleInit()).resolves.toBeUndefined();

    expect(error).toHaveBeenNthCalledWith(1, 'Could not ensure the catalog search index: not authorized');
    expect(error).toHaveBeenNthCalledWith(2, 'Could not ensure the catalog search index: unknown error');
  });

  it('browses the newest videos when the keyword is empty', async () => {
    await expect(repository.search('', 3)).resolves.toEqual([{ _id: 1 }]);

    expect(find).toHaveBeenCalledWith({ o: { $exists: false }, s: { $type: 'string', $ne: '' }, _id: { $gte: 1_000_000_000, $lt: 4_000_000_000 } }, { projection: { s: 1, n: 1, d: 1, t: 1, u: 1, c: 1, p: 1, x: 1 } });
    expect(sort).toHaveBeenCalledWith({ _id: -1 });
    expect(skip).toHaveBeenCalledWith(2 * PER_PAGE_SIZE);
    expect(limit).toHaveBeenCalledWith(PER_PAGE_SIZE);
  });

  it('searches by text score when a keyword is given', async () => {
    await repository.search('latex', 1);

    expect(find).toHaveBeenCalledWith(
      {
        $text: { $search: 'latex' },
        o: { $exists: false },
        s: { $type: 'string', $ne: '' },
        _id: { $gte: 1_000_000_000, $lt: 4_000_000_000 },
      },
      { projection: { s: 1, n: 1, d: 1, t: 1, u: 1, c: 1, p: 1, x: 1, score: { $meta: 'textScore' } } },
    );
    expect(sort).toHaveBeenCalledWith({ score: { $meta: 'textScore' }, _id: -1 });
    expect(skip).toHaveBeenCalledWith(0);
  });
});
