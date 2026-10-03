import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AlbumRepository } from '../repositories/album.repository';
import type { IMediaSnapshot } from '../shared/interfaces/media-snapshot.interface';
import { encryptURLToShortToken } from '../shared/url-token';
import { AlbumService, MAX_ALBUMS } from './album.service';

const SNAPSHOT: IMediaSnapshot = { title: 't', duration: 1, postedAt: '', thumbnailSrc: [] };
const ALBUM_ID = '65f0c0ffee0000000000abcd';
const ALBUM = { id: ALBUM_ID, name: 'Trips', createdAt: new Date(), medias: [] };

describe('AlbumService', () => {
  let service: AlbumService;
  const repository = {
    findAll: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    rename: jest.fn(),
    delete: jest.fn(),
    addMedia: jest.fn(),
    removeMedia: jest.fn(),
  };
  const mediaID = encryptURLToShortToken('https://example.com/v');

  beforeEach(async () => {
    Object.values(repository).forEach((mock) => mock.mockReset());
    const module = await Test.createTestingModule({
      providers: [AlbumService, { provide: AlbumRepository, useValue: repository }],
    }).compile();

    service = module.get(AlbumService);
  });

  it('lists albums', async () => {
    repository.findAll.mockResolvedValue([ALBUM]);
    await expect(service.findAll()).resolves.toEqual({ albums: [ALBUM] });
  });

  it('creates albums up to the limit', async () => {
    repository.count.mockResolvedValueOnce(0);
    repository.create.mockResolvedValueOnce(ALBUM);
    await expect(service.create('Trips')).resolves.toBe(ALBUM);

    repository.count.mockResolvedValueOnce(MAX_ALBUMS);
    await expect(service.create('More')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('renames an album, 404ing for a bad id or a missing album', async () => {
    repository.rename.mockResolvedValueOnce(ALBUM);
    await expect(service.rename(ALBUM_ID, 'Trips')).resolves.toBe(ALBUM);
    expect(repository.rename).toHaveBeenCalledWith(ALBUM_ID, 'Trips');

    await expect(service.rename('nope', 'X')).rejects.toBeInstanceOf(NotFoundException);

    repository.rename.mockResolvedValueOnce(null);
    await expect(service.rename(ALBUM_ID, 'X')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes an album, 404ing when it is missing', async () => {
    repository.delete.mockResolvedValueOnce(true);
    await expect(service.delete(ALBUM_ID)).resolves.toBeUndefined();

    repository.delete.mockResolvedValueOnce(false);
    await expect(service.delete(ALBUM_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('adds and removes media, checking both ids', async () => {
    repository.addMedia.mockResolvedValueOnce(ALBUM);
    await expect(service.addMedia(ALBUM_ID, mediaID, SNAPSHOT)).resolves.toBe(ALBUM);
    expect(repository.addMedia).toHaveBeenCalledWith(ALBUM_ID, mediaID, SNAPSHOT);

    repository.removeMedia.mockResolvedValueOnce(ALBUM);
    await expect(service.removeMedia(ALBUM_ID, mediaID)).resolves.toBe(ALBUM);

    await expect(service.addMedia(ALBUM_ID, '', SNAPSHOT)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.removeMedia(ALBUM_ID, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.addMedia('nope', mediaID, SNAPSHOT)).rejects.toBeInstanceOf(NotFoundException);
  });
});
