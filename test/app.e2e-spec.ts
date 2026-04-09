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

require('dotenv').config();

describe('App (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(() => {
    if (!process.env.CRYPTA) {
      process.env.CRYPTA = 'e2e-test-crypta-key-for-url-tokens';
    }
    if (!process.env.XMD) {
      throw new Error('XMD must be set in .env (or environment) for e2e — same as integration tests');
    }
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET / returns 404 when no root route is registered', () => {
    return request(app.getHttpServer()).get('/').expect(404);
  });

  it('GET /media without keyword returns 400', () => {
    return request(app.getHttpServer()).get('/media').expect(400);
  });
});
