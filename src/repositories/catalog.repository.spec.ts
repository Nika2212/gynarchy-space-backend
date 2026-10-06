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
  const aggregateToArray = jest.fn();
  const aggregate = jest.fn((_pipeline: unknown[]) => ({ toArray: aggregateToArray }));
  const collection = jest.fn(() => ({ find, createIndex, aggregate }));

  beforeEach(async () => {
    [toArray, limit, skip, sort, find, createIndex, collection, aggregate, aggregateToArray].forEach((mock) => mock.mockReset());
    limit.mockImplementation(() => ({ toArray }));
    skip.mockImplementation(() => ({ limit }));
    sort.mockImplementation(() => ({ skip }));
    find.mockImplementation(() => ({ sort }));
    aggregate.mockImplementation(() => ({ toArray: aggregateToArray }));
    collection.mockImplementation(() => ({ find, createIndex, aggregate }));
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
    await expect(repository.search([], 3)).resolves.toEqual([{ _id: 1 }]);

    expect(find).toHaveBeenCalledWith({ o: { $exists: false }, s: { $type: 'string', $ne: '' }, _id: { $gte: 1_000_000_000, $lt: 4_000_000_000 } }, { projection: { s: 1, n: 1, d: 1, t: 1, u: 1, c: 1, p: 1, x: 1 } });
    expect(sort).toHaveBeenCalledWith({ _id: -1 });
    expect(skip).toHaveBeenCalledWith(2 * PER_PAGE_SIZE);
    expect(limit).toHaveBeenCalledWith(PER_PAGE_SIZE);
  });

  it('runs a fuzzy Atlas search with prefix matching on the last term', async () => {
    aggregateToArray.mockResolvedValue([{ _id: 2 }]);

    await expect(repository.search(['lokctober', 'cag'], 2)).resolves.toEqual([{ _id: 2 }]);

    const pipeline = aggregate.mock.calls[0][0] as Record<string, any>[];
    const [{ $search }, match, skipStage, limitStage] = pipeline;
    expect($search.index).toBe('default');
    expect($search.compound.must[0].compound.minimumShouldMatch).toBe(2);
    const [first, last] = $search.compound.must[0].compound.should;
    expect(first.compound.should[0].text.fuzzy).toEqual({ maxEdits: 2, prefixLength: 1, maxExpansions: 50 });
    expect(first.compound.should).toHaveLength(4);
    expect(last.compound.should[4].wildcard.query).toBe('cag*');
    expect($search.compound.should[0].phrase.query).toEqual(['lokctober', 'cag']);
    expect(match.$match.o).toEqual({ $exists: false });
    expect(skipStage).toEqual({ $skip: PER_PAGE_SIZE });
    expect(limitStage).toEqual({ $limit: PER_PAGE_SIZE });
    expect(find).not.toHaveBeenCalled();
  });

  it('falls back to the text index when the Atlas search fails', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    aggregateToArray.mockRejectedValue(new Error('index not found'));

    await repository.search(['latex', 'mistress'], 1);

    expect(warn).toHaveBeenCalledWith('Fuzzy search failed, using the text index instead: index not found');
    expect((find.mock.calls as unknown[][])[0][0]).toMatchObject({ $text: { $search: 'latex mistress' } });
  });

  it('searches by text score when the fallback runs', async () => {
    aggregateToArray.mockRejectedValue('down');

    await repository.search(['latex'], 1);

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
