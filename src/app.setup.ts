import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { parseCorsOrigins, resolveTrustProxy } from './shared/config/http';

// Applies CORS, helmet, body limits, global prefix, and validation to the app.
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  const origins = parseCorsOrigins(config.get<string>('CORS_ORIGIN'));

  if (origins.length === 0) {
    throw new Error('CORS_ORIGIN is required');
  }

  const trustProxy = resolveTrustProxy(config.get<string>('TRUST_PROXY'));
  if (trustProxy !== false) {
    app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);
  }

  app.use(json({ limit: '16kb' }));
  app.use(urlencoded({ extended: true, limit: '16kb' }));
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  app.enableCors({
    origin: origins,
    credentials: false,
  });
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
}
