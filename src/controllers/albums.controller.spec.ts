import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { SecurityGuard } from '../core/security.guard';
import { AlbumService } from '../services/album.service';
import { AlbumsController } from './albums.controller';

const ALBUM = { id: 'a1', name: 'Trips', createdAt: '2026-01-01T00:00:00.000Z', medias: [] };
const MEDIA = { title: 't', duration: 1, postedAt: '', thumbnailSrc: [] };

describe('AlbumsController', () => {
  let app: INestApplication;
  const service = {
    findAll: jest.fn(),
    create: jest.fn(),
    rename: jest.fn(),
    delete: jest.fn(),
    addMedia: jest.fn(),
    removeMedia: jest.fn(),
  };

  beforeEach(async () => {
    Object.values(service).forEach((mock) => mock.mockReset());
    service.findAll.mockResolvedValue({ albums: [ALBUM] });
    service.create.mockResolvedValue(ALBUM);
    service.rename.mockResolvedValue(ALBUM);
    service.delete.mockResolvedValue(undefined);
    service.addMedia.mockResolvedValue(ALBUM);
    service.removeMedia.mockResolvedValue(ALBUM);

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AlbumsController],
      providers: [{ provide: AlbumService, useValue: service }],
    })
      .overrideGuard(SecurityGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /albums lists albums', async () => {
    await request(app.getHttpServer()).get('/albums').expect(200).expect({ albums: [ALBUM] });
  });

  it('POST /albums creates an album with a trimmed name, rejecting an empty one', async () => {
    await request(app.getHttpServer()).post('/albums').send({ name: '  Trips ' }).expect(201).expect(ALBUM);
    expect(service.create).toHaveBeenCalledWith('Trips');

    await request(app.getHttpServer()).post('/albums').send({ name: '' }).expect(400);
  });

  it('PATCH /albums/:id renames', async () => {
    await request(app.getHttpServer()).patch('/albums/a1').send({ name: 'New' }).expect(200);
    expect(service.rename).toHaveBeenCalledWith('a1', 'New');
  });

  it('DELETE /albums/:id deletes', async () => {
    await request(app.getHttpServer()).delete('/albums/a1').expect(204);
    expect(service.delete).toHaveBeenCalledWith('a1');
  });

  it('POST and DELETE /albums/:id/medias/:mediaId add and remove media', async () => {
    await request(app.getHttpServer()).post('/albums/a1/medias/m1').send({ media: MEDIA }).expect(200);
    expect(service.addMedia).toHaveBeenCalledWith('a1', 'm1', MEDIA);

    await request(app.getHttpServer()).delete('/albums/a1/medias/m1').expect(200);
    expect(service.removeMedia).toHaveBeenCalledWith('a1', 'm1');
  });
});
