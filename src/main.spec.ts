import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { configureApp } from './app.setup';
import { bootstrap, isDirectStart, startIfDirect } from './main';

jest.mock('@nestjs/core', () => ({
  NestFactory: {
    create: jest.fn().mockResolvedValue({
      get: () => ({ get: () => undefined }),
      listen: jest.fn().mockResolvedValue(undefined),
      getUrl: jest.fn().mockResolvedValue('http://127.0.0.1:3000'),
    }),
  },
}));

jest.mock('./app.setup', () => ({
  configureApp: jest.fn(),
}));

describe('bootstrap', () => {
  const listen = jest.fn();
  const getUrl = jest.fn().mockResolvedValue('http://127.0.0.1:3000');
  const configGet = jest.fn();

  beforeEach(() => {
    listen.mockResolvedValue(undefined);
    getUrl.mockResolvedValue('http://127.0.0.1:3000');
    configGet.mockReturnValue(undefined);
    (NestFactory.create as jest.Mock).mockResolvedValue({
      get: () => ({ get: configGet }),
      listen,
      getUrl,
    });
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    delete process.env.PORT;
  });

  afterEach(() => {
    delete process.env.PORT;
    jest.restoreAllMocks();
  });

  it('listens on PORT from the environment', async () => {
    process.env.PORT = '4000';
    await bootstrap();
    expect(configureApp).toHaveBeenCalled();
    expect(listen).toHaveBeenCalledWith(4000, '0.0.0.0');
  });

  it('falls back to config PORT then 3000', async () => {
    configGet.mockReturnValue('3500');
    await bootstrap();
    expect(listen).toHaveBeenCalledWith(3500, '0.0.0.0');

    configGet.mockReturnValue(undefined);
    await bootstrap();
    expect(listen).toHaveBeenCalledWith(3000, '0.0.0.0');
  });

  it('starts only when Jest is not running the file', () => {
    const start = jest.fn();
    expect(isDirectStart({} as NodeJS.ProcessEnv)).toBe(true);
    expect(isDirectStart({ JEST_WORKER_ID: '1' } as NodeJS.ProcessEnv)).toBe(false);
    startIfDirect({} as NodeJS.ProcessEnv, start);
    startIfDirect({ JEST_WORKER_ID: '1' } as NodeJS.ProcessEnv, start);
    expect(start).toHaveBeenCalledTimes(1);
  });
});
