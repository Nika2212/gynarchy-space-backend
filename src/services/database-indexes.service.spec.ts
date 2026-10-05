import { Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { AlbumDocument } from '../repositories/album.schema';
import { MediaDocument } from '../repositories/media.schema';
import { DatabaseIndexesService } from './database-indexes.service';

describe('DatabaseIndexesService', () => {
  const mediaModel = { collection: { collectionName: 'medias' }, syncIndexes: jest.fn() };
  const albumModel = { collection: { collectionName: 'albums' }, syncIndexes: jest.fn() };
  let service: DatabaseIndexesService;

  beforeEach(async () => {
    jest.restoreAllMocks();
    mediaModel.syncIndexes.mockReset();
    albumModel.syncIndexes.mockReset();

    const module = await Test.createTestingModule({
      providers: [DatabaseIndexesService, { provide: getModelToken(MediaDocument.name), useValue: mediaModel }, { provide: getModelToken(AlbumDocument.name), useValue: albumModel }],
    }).compile();

    service = module.get(DatabaseIndexesService);
  });

  it('syncs the indexes of medias and albums on start and reports dropped ones', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    mediaModel.syncIndexes.mockResolvedValue(['identifierHash_1']);
    albumModel.syncIndexes.mockResolvedValue([]);

    await service.onApplicationBootstrap();

    expect(mediaModel.syncIndexes).toHaveBeenCalledTimes(1);
    expect(albumModel.syncIndexes).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Dropped outdated indexes on medias: identifierHash_1');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('logs a failed sync without stopping the app or the other collection', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    mediaModel.syncIndexes.mockRejectedValue(new Error('not authorized'));
    albumModel.syncIndexes.mockResolvedValue([]);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith('Could not sync indexes on medias: not authorized');
    expect(albumModel.syncIndexes).toHaveBeenCalledTimes(1);
  });
});
