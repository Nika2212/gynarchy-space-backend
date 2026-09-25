import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { ImageProxyService } from '../services/image-proxy.service';
import { ImagesController } from './images.controller';

describe('ImagesController', () => {
  let app: INestApplication;
  const proxy = jest.fn();

  beforeEach(async () => {
    proxy.mockImplementation((_id: string, res: { status: (code: number) => { send: (body: string) => void } }) => {
      res.status(200).send('ok');
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [ImagesController],
      providers: [{ provide: ImageProxyService, useValue: { proxy } }],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /images/:id proxies the image', async () => {
    await request(app.getHttpServer()).get('/images/abc').expect(200).expect('ok');
    expect(proxy).toHaveBeenCalledWith('abc', expect.anything());
  });
});
