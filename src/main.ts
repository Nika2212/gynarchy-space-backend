import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

// Starts the Nest app and listens on PORT for every network interface.
export async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });
  configureApp(app);

  const config = app.get(ConfigService);
  const port = Number(process.env.PORT) || Number(config.get<string>('PORT')) || 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`Listening on ${await app.getUrl()}`);
}
// True when this file is the process entrypoint, not a Jest import.
export function isDirectStart(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.JEST_WORKER_ID === undefined;
}

// Starts the process only when this file is the entrypoint.
export function startIfDirect(env: NodeJS.ProcessEnv = process.env, start = bootstrap): void {
  if (isDirectStart(env)) {
    void start();
  }
}

startIfDirect();
