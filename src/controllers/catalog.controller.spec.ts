import { INestApplication, InternalServerErrorException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { SecurityGuard } from '../core/security.guard';
import { CatalogService } from '../services/catalog.service';
import type { IMediaContainer } from '../shared/interfaces/media-container.interface';
import { CatalogController } from './catalog.controller';

describe('CatalogController', () => {
  let app: INestApplication;
  const search = jest.fn();
  const emptyPayload: IMediaContainer = {
    medias: [],
    meta: { currentPage: 1, isLastPage: true },
  };

  beforeEach(async () => {
    search.mockReset();
    search.mockResolvedValue(emptyPayload);

    const moduleRef = await Test.createTestingModule({
      controllers: [CatalogController],
      providers: [{ provide: CatalogService, useValue: { search } }],
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

  it('GET /catalog returns one catalog page', async () => {
    await request(app.getHttpServer()).get('/catalog').query({ keyword: 'latex', page: '2' }).expect(200).expect(emptyPayload);

    expect(search).toHaveBeenCalledWith(expect.objectContaining({ keyword: 'latex', page: 2 }));
  });

  it('GET /catalog defaults a missing or invalid page to 1', async () => {
    await request(app.getHttpServer()).get('/catalog').query({ keyword: 'only' }).expect(200);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ keyword: 'only', page: 1 }));

    search.mockClear();
    await request(app.getHttpServer()).get('/catalog').query({ keyword: 'x', page: 'nope' }).expect(200);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ keyword: 'x', page: 1 }));
  });

  it('GET /catalog propagates service errors', async () => {
    search.mockRejectedValueOnce(new InternalServerErrorException('boom'));
    await request(app.getHttpServer()).get('/catalog').query({ keyword: 'k' }).expect(500);
  });
});
