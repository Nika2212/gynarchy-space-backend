jest.mock('../src/core/helpers/console', () => ({
  Console: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

require('dotenv').config({ path: '.env.dev' });

describe('App (e2e)', () => {
  let app: INestApplication<App>;
  let accessToken: string;

  beforeAll(() => {
    process.env.NODE_ENV = 'development';
    if (!process.env.XMD || !process.env.JWT_SECRET || !process.env.APP_PASSCODE || !process.env.CORS_ORIGIN) {
      throw new Error('XMD, JWT_SECRET, APP_PASSCODE, and CORS_ORIGIN must be set in .env.dev for e2e');
    }
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();

    const login = await request(app.getHttpServer())
      .post('/api/security/passcode')
      .send({ passcode: process.env.APP_PASSCODE })
      .expect(200);

    accessToken = (login.body as { accessToken: string }).accessToken;
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET / returns 404 when no root route is registered', () => {
    return request(app.getHttpServer()).get('/').expect(404);
  });

  it('GET /api/health returns 200 without auth', () => {
    return request(app.getHttpServer()).get('/api/health').expect(200).expect({ status: 'ok' });
  });

  it('GET /api/media without token returns 401', () => {
    return request(app.getHttpServer()).get('/api/media').expect(401);
  });

  it('GET /api/media without keyword returns 400', () => {
    return request(app.getHttpServer())
      .get('/api/media')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
  });

  it('POST /api/security/passcode without body returns 400', () => {
    return request(app.getHttpServer()).post('/api/security/passcode').send({}).expect(400);
  });
});
