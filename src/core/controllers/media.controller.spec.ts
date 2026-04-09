import { INestApplication, InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { IMediaContainer } from '../../interfaces/media-container.interface';
import { MediaService } from '../services/media.service';
import { MediaController } from './media.controller';

describe('MediaController', () => {
  let app: INestApplication;
  let findAll: jest.Mock;

  const emptyPayload: IMediaContainer = {
    medias: [],
    meta: { currentPage: 1, isLastPage: true },
  };

  beforeEach(async () => {
    findAll = jest.fn().mockResolvedValue(emptyPayload);

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [
        {
          provide: MediaService,
          useValue: { findAll },
        },
      ],
    }).compile();

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
});
