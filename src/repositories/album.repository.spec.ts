import { CentreRegistry } from '../core/centres/centre.registry';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { IMediaSnapshot } from '../shared/interfaces/media-snapshot.interface';
import { AlbumRepository } from './album.repository';
import { AlbumDocument } from './album.schema';

const SNAPSHOT: IMediaSnapshot = {
  title: 'Title',
  duration: 61_000,
  postedAt: '2 days ago',
  thumbnailSrc: ['/images/a'],
};

function storedItem(identifier: string, addedAt: Date, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    identifier,
    title: 'Stored',
    thumbnailSrc: '["/images/x"]',
    postedAt: '',
    duration: 10,
    addedAt,
    ...overrides,
  };
}

function storedAlbum(name: string, items: Record<string, unknown>[] = [], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: 'album-1',
    name,
    items,
    createdAt: new Date('2026-01-01'),
    save: jest.fn(),
    ...overrides,
  };
}

describe('AlbumRepository', () => {
  let repository: AlbumRepository;
  const execFind = jest.fn();
  const execFindById = jest.fn();
  const execDelete = jest.fn();
  const execCount = jest.fn();
  const sort = jest.fn(() => ({ exec: execFind }));
  const find = jest.fn(() => ({ sort }));
  const findById = jest.fn(() => ({ exec: execFindById }));
  const deleteOne = jest.fn(() => ({ exec: execDelete }));
  const countDocuments = jest.fn(() => ({ exec: execCount }));
  const create = jest.fn();

  beforeEach(async () => {
    [execFind, execFindById, execDelete, execCount, sort, find, findById, deleteOne, countDocuments, create].forEach((mock) => mock.mockReset());
    sort.mockImplementation(() => ({ exec: execFind }));
    find.mockImplementation(() => ({ sort }));
    findById.mockImplementation(() => ({ exec: execFindById }));
    deleteOne.mockImplementation(() => ({ exec: execDelete }));
    countDocuments.mockImplementation(() => ({ exec: execCount }));
    create.mockImplementation(async (doc: Record<string, unknown>) => ({ _id: 'new-id', ...doc }));

    const module = await Test.createTestingModule({
      providers: [AlbumRepository, { provide: CentreRegistry, useValue: { findByURL: () => undefined } }, { provide: getModelToken(AlbumDocument.name), useValue: { find, findById, deleteOne, countDocuments, create } }],
    }).compile();

    repository = module.get(AlbumRepository);
  });

  it('loads albums newest first with media newest-added first, skipping albums without a name and items without an identifier', async () => {
    execFind.mockResolvedValue([
      storedAlbum('Trips', [
        storedItem('old', new Date('2026-01-01')),
        storedItem('new', new Date('2026-02-01'), { duration: undefined, title: undefined, postedAt: undefined }),
        storedItem('bad', new Date('2026-03-01'), { identifier: '' }),
        storedItem('raw', new Date('2026-01-15'), { thumbnailSrc: '{"a":1}' }),
        storedItem('junk', new Date('2026-01-10'), { thumbnailSrc: 'corrupt' }),
      ]),
      storedAlbum('x', [], { name: undefined }),
      storedAlbum('Undated', [], { createdAt: undefined }),
    ]);

    const albums = await repository.findAll();

    expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(albums.map((album) => album.name)).toEqual(['Trips', 'Undated']);
    expect(albums[0].medias.map((media) => media.identifier)).toEqual(['new', 'raw', 'junk', 'old']);
    expect(albums[0].medias[0]).toMatchObject({ url: '/media/new', title: '', postedAt: '', duration: 0, thumbnailSrc: ['/images/x'] });
    expect(albums[0].medias[1].thumbnailSrc).toEqual([]);
    expect(albums[0].medias[2].thumbnailSrc).toEqual([]);
    expect(albums[1].createdAt).toEqual(new Date(0));
  });

  it('counts albums', async () => {
    execCount.mockResolvedValue(3);
    await expect(repository.count()).resolves.toBe(3);
  });

  it('creates an album with its name', async () => {
    await expect(repository.create('Road trip')).resolves.toMatchObject({ id: 'new-id', name: 'Road trip', medias: [] });
    expect(create.mock.calls[0][0]).toEqual({ name: 'Road trip', items: [] });
  });

  it('renames an album, or returns null when it is missing', async () => {
    execFindById.mockResolvedValueOnce(null);
    await expect(repository.rename('missing', 'X')).resolves.toBeNull();

    const row = storedAlbum('Old');
    execFindById.mockResolvedValueOnce(row);
    await expect(repository.rename('album-1', 'New')).resolves.toMatchObject({ name: 'New' });
    expect(row.save).toHaveBeenCalled();
  });

  it('deletes an album and reports whether it existed', async () => {
    execDelete.mockResolvedValueOnce({ deletedCount: 1 });
    await expect(repository.delete('album-1')).resolves.toBe(true);
    expect(deleteOne).toHaveBeenCalledWith({ _id: 'album-1' });

    execDelete.mockResolvedValueOnce({ deletedCount: 0 });
    await expect(repository.delete('album-1')).resolves.toBe(false);
  });

  it('adds a new media, refreshes an existing one, or returns null for a missing album', async () => {
    execFindById.mockResolvedValueOnce(null);
    await expect(repository.addMedia('missing', 'm1', SNAPSHOT)).resolves.toBeNull();

    const row = storedAlbum('Trips', [storedItem('keep', new Date('2026-01-01'))]);
    execFindById.mockResolvedValueOnce(row);
    await expect(repository.addMedia('album-1', 'm1', SNAPSHOT)).resolves.toMatchObject({ medias: [{ identifier: 'm1', title: 'Title', thumbnailSrc: ['/images/a'] }, { identifier: 'keep' }] });
    expect(row.save).toHaveBeenCalled();

    const addedAt = new Date('2026-01-05');
    const again = storedAlbum('Trips', [storedItem('m1', addedAt), storedItem('other', new Date('2026-01-01'))]);
    execFindById.mockResolvedValueOnce(again);
    const album = await repository.addMedia('album-1', 'm1', { ...SNAPSHOT, title: 'Renamed' });
    expect(album?.medias).toHaveLength(2);
    expect(album?.medias[0]).toMatchObject({ identifier: 'm1', title: 'Renamed', addedAt });
  });

  it('removes a media, or returns null for a missing album', async () => {
    execFindById.mockResolvedValueOnce(null);
    await expect(repository.removeMedia('missing', 'm1')).resolves.toBeNull();

    const row = storedAlbum('Trips', [storedItem('m1', new Date()), storedItem('m2', new Date())]);
    execFindById.mockResolvedValueOnce(row);
    await expect(repository.removeMedia('album-1', 'm1')).resolves.toMatchObject({ medias: [{ identifier: 'm2' }] });
    expect(row.save).toHaveBeenCalled();
  });
});
