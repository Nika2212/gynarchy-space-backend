import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { SecurityService } from '../services/security.service';
import { SecurityController } from './security.controller';

describe('SecurityController', () => {
  let app: INestApplication;
  const auth = jest.fn();

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SecurityController],
      providers: [{ provide: SecurityService, useValue: { auth } }],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    auth.mockReset();
    await app.close();
  });

  it('POST /security/passcode returns the auth payload', async () => {
    auth.mockResolvedValue({ accessToken: 'token' });

    await request(app.getHttpServer())
      .post('/security/passcode')
      .set('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')
      .set('X-Display-Mode', 'standalone')
      .send({ passcode: '0000' })
      .expect(200)
      .expect({ accessToken: 'token' });

    expect(auth).toHaveBeenCalledWith('0000', expect.any(String), {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      displayMode: 'standalone',
    });
  });
});
