import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { configureApp } from './app.setup';

function mockApp(config: Record<string, string | undefined>) {
  const instance = { set: jest.fn() };
  const app = {
    get: jest.fn().mockReturnValue({ get: (key: string) => config[key] }),
    getHttpAdapter: () => ({ getInstance: () => instance }),
    use: jest.fn(),
    setGlobalPrefix: jest.fn(),
    enableShutdownHooks: jest.fn(),
    enableCors: jest.fn(),
    useGlobalPipes: jest.fn(),
  };
  return { app: app as unknown as INestApplication, instance, raw: app };
}

describe('configureApp', () => {
  it('throws when CORS_ORIGIN is empty', () => {
    const { app } = mockApp({ CORS_ORIGIN: '' });
    expect(() => configureApp(app)).toThrow('CORS_ORIGIN is required');
  });

  it('applies prefix, cors, helmet, and pipes without a trust proxy', () => {
    const { app, raw, instance } = mockApp({ CORS_ORIGIN: 'http://localhost:4200' });
    configureApp(app);
    expect(instance.set).not.toHaveBeenCalled();
    expect(raw.setGlobalPrefix).toHaveBeenCalledWith('api');
    expect(raw.enableCors).toHaveBeenCalledWith({
      origin: ['http://localhost:4200'],
      credentials: false,
      exposedHeaders: ['Accept-Ranges', 'Content-Range', 'Content-Length'],
    });
    expect(raw.useGlobalPipes).toHaveBeenCalled();
  });

  it('enables trust proxy when TRUST_PROXY is set', () => {
    const { app, instance } = mockApp({ CORS_ORIGIN: 'http://localhost:4200', TRUST_PROXY: '1' });
    configureApp(app);
    expect(instance.set).toHaveBeenCalledWith('trust proxy', 1);
  });
});
