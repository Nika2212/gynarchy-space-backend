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
  let stream: jest.Mock;
  let toggleFavorite: jest.Mock;
  let toggleLike: jest.Mock;
  let toggleHidden: jest.Mock;

  const emptyPayload: IMediaContainer = {
    medias: [],
    meta: { currentPage: 1, isLastPage: true },
  };

  beforeEach(async () => {
    findAll = jest.fn().mockResolvedValue(emptyPayload);
    stream = jest.fn().mockImplementation((_id, _range, res) => {
      res.status(200).send('stream');
    });
    toggleFavorite = jest.fn().mockResolvedValue({ isFavorite: true });
    toggleLike = jest.fn().mockResolvedValue({ isLiked: true });
    toggleHidden = jest.fn().mockResolvedValue({ isHidden: true });

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [
        {
          provide: MediaService,
          useValue: { findAll, toggleFavorite, toggleLike, toggleHidden },
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

  it('GET /media/:id/favorite toggles favorite', async () => {
    await request(app.getHttpServer()).get('/media/abc/favorite').expect(200).expect({ isFavorite: true });
    expect(toggleFavorite).toHaveBeenCalledWith('abc');
  });

  it('GET /media/:id/like toggles like', async () => {
    await request(app.getHttpServer()).get('/media/abc/like').expect(200).expect({ isLiked: true });
    expect(toggleLike).toHaveBeenCalledWith('abc');
  });

  it('GET /media/:id/hide toggles hidden', async () => {
    await request(app.getHttpServer()).get('/media/abc/hide').expect(200).expect({ isHidden: true });
    expect(toggleHidden).toHaveBeenCalledWith('abc');
  });
});
