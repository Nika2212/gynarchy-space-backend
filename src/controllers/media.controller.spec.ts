import { INestApplication, InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { SecurityGuard } from '../core/security.guard';
import { DownloadService } from '../services/download.service';
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
  let startDownload: jest.Mock;
  let removeDownload: jest.Mock;
  let downloadSnapshot: jest.Mock;
  let playbackURL: jest.Mock;

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
    startDownload = jest.fn().mockResolvedValue({ identifier: 'abc', state: 'queued' });
    removeDownload = jest.fn().mockResolvedValue(null);
    downloadSnapshot = jest.fn().mockReturnValue({ jobs: [], storage: { isConfigured: true, usedBytes: 0, limitBytes: 1, freeBytes: 1 } });
    playbackURL = jest.fn().mockResolvedValue(null);

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
        {
          provide: DownloadService,
          useValue: { start: startDownload, remove: removeDownload, snapshot: downloadSnapshot, playbackURL },
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

  it('GET /media/:id/playback returns the signed storage link of a downloaded media, null otherwise', async () => {
    await request(app.getHttpServer()).get('/media/abc/playback').expect(200).expect({ url: null });

    playbackURL.mockResolvedValue('https://storage.test/media/hash.mp4?X-Amz-Signature=1');
    await request(app.getHttpServer()).get('/media/abc/playback').expect(200).expect({ url: 'https://storage.test/media/hash.mp4?X-Amz-Signature=1' });
    expect(playbackURL).toHaveBeenCalledWith('abc');
    expect(stream).not.toHaveBeenCalled();
  });

  it('POST /media/:id/download queues the download with the card', async () => {
    const media = { title: 't', duration: 1, postedAt: '', thumbnailSrc: [] };

    await request(app.getHttpServer()).post('/media/abc/download').send({ media }).expect(202).expect({ identifier: 'abc', state: 'queued' });
    expect(startDownload).toHaveBeenCalledWith('abc', media);
  });

  it('DELETE /media/:id/download returns flags when a stored copy was removed, 204 otherwise', async () => {
    await request(app.getHttpServer()).delete('/media/abc/download').expect(204);

    removeDownload.mockResolvedValue({ identifier: 'abc', isDownloaded: false });
    await request(app.getHttpServer()).delete('/media/abc/download').expect(200).expect({ identifier: 'abc', isDownloaded: false });
  });

  it('GET /media/downloads returns the jobs and storage usage', async () => {
    await request(app.getHttpServer())
      .get('/media/downloads')
      .expect(200)
      .expect({ jobs: [], storage: { isConfigured: true, usedBytes: 0, limitBytes: 1, freeBytes: 1 } });
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
