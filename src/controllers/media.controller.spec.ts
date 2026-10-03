import { INestApplication, InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { SecurityGuard } from '../core/security.guard';
import { MediaStreamService } from '../services/media-stream.service';
import { MediaService } from '../services/media.service';
import type { IMediaContainer } from '../shared/interfaces/media-container.interface';
import { MediaController } from './media.controller';

describe('MediaController', () => {
  let app: INestApplication;
  let findAll: jest.Mock;
  let findLibrary: jest.Mock;
  let stream: jest.Mock;
  let toggleFavorite: jest.Mock;
  let toggleLike: jest.Mock;
  let saveWatchPosition: jest.Mock;
  let clearWatchHistory: jest.Mock;
  let clearAllWatchHistory: jest.Mock;

  const emptyPayload: IMediaContainer = {
    medias: [],
    meta: { currentPage: 1, isLastPage: true },
  };

  beforeEach(async () => {
    findAll = jest.fn().mockResolvedValue(emptyPayload);
    findLibrary = jest.fn().mockResolvedValue({ medias: [] });
    stream = jest.fn().mockImplementation((_id, _range, res) => {
      res.status(200).send('stream');
    });
    toggleFavorite = jest.fn().mockResolvedValue({ isFavorite: true });
    toggleLike = jest.fn().mockResolvedValue({ isLiked: true });
    saveWatchPosition = jest.fn().mockResolvedValue({ watchPositionAt: 30_000 });
    clearWatchHistory = jest.fn().mockResolvedValue({ watchPositionAt: null });
    clearAllWatchHistory = jest.fn().mockResolvedValue(undefined);

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [
        {
          provide: MediaService,
          useValue: {
            findAll,
            findLibrary,
            toggleFavorite,
            toggleLike,
            saveWatchPosition,
            clearWatchHistory,
            clearAllWatchHistory,
          },
        },
        {
          provide: MediaStreamService,
          useValue: { stream },
        },
      ],
    })
      .overrideGuard(SecurityGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /media returns 200 and JSON from MediaService.findAll', async () => {
    await request(app.getHttpServer())
      .get('/media')
      .query({ keyword: 'test', page: '1' })
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual(emptyPayload);
      });

    expect(findAll).toHaveBeenCalledTimes(1);
    expect(findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        keyword: 'test',
        page: 1,
      }),
    );
  });

  it('GET /media defaults page to 1 when missing or not a numbered string', async () => {
    await request(app.getHttpServer()).get('/media').query({ keyword: 'only' }).expect(200);

    expect(findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        keyword: 'only',
        page: 1,
      }),
    );

    findAll.mockClear();

    await request(app.getHttpServer()).get('/media').query({ keyword: 'x', page: 'nope' }).expect(200);

    expect(findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        keyword: 'x',
        page: 1,
      }),
    );
  });

  it('GET /media propagates service errors', async () => {
    findAll.mockRejectedValueOnce(new InternalServerErrorException('boom'));
    await request(app.getHttpServer()).get('/media').query({ keyword: 'k' }).expect(500);
  });

  it('GET /media/library returns the stored medias', async () => {
    await request(app.getHttpServer()).get('/media/library').expect(200).expect({ medias: [] });
    expect(findLibrary).toHaveBeenCalled();
  });

  it('GET /media/:id streams with the Range header', async () => {
    await request(app.getHttpServer()).get('/media/abc').set('Range', 'bytes=0-1').expect(200).expect('stream');
    expect(stream).toHaveBeenCalledWith('abc', 'bytes=0-1', expect.anything());
  });

  it('GET /media/:id/download returns a placeholder', async () => {
    await request(app.getHttpServer())
      .get('/media/abc/download')
      .expect(200)
      .expect({ message: 'This action downloads media #abc' });
  });

  it('PATCH /media/:id/favorite toggles favorite with the card', async () => {
    await request(app.getHttpServer()).patch('/media/abc/favorite').send({ media: { title: 't', duration: 1, postedAt: '', thumbnailSrc: [] } }).expect(200).expect({ isFavorite: true });
    expect(toggleFavorite).toHaveBeenCalledWith('abc', { title: 't', duration: 1, postedAt: '', thumbnailSrc: [] });
  });

  it('PATCH /media/:id/like toggles like with the card', async () => {
    await request(app.getHttpServer()).patch('/media/abc/like').send({ media: { title: 't', duration: 1, postedAt: '', thumbnailSrc: [] } }).expect(200).expect({ isLiked: true });
    expect(toggleLike).toHaveBeenCalledWith('abc', { title: 't', duration: 1, postedAt: '', thumbnailSrc: [] });
  });

  it('DELETE /media/:id/watch-history removes one media from the history', async () => {
    await request(app.getHttpServer()).delete('/media/abc/watch-history').expect(200).expect({ watchPositionAt: null });
    expect(clearWatchHistory).toHaveBeenCalledWith('abc');
  });

  it('DELETE /media/history clears the whole history', async () => {
    await request(app.getHttpServer()).delete('/media/history').expect(204);
    expect(clearAllWatchHistory).toHaveBeenCalled();
  });

  it('PATCH /media/:id/watch-position saves the playback position', async () => {
    await request(app.getHttpServer())
      .patch('/media/abc/watch-position')
      .send({ watchPositionAt: 30_000, media: { title: 't', duration: 1, postedAt: '', thumbnailSrc: [] } })
      .expect(200)
      .expect({ watchPositionAt: 30_000 });
    expect(saveWatchPosition).toHaveBeenCalledWith('abc', 30_000, { title: 't', duration: 1, postedAt: '', thumbnailSrc: [] });
  });
});
