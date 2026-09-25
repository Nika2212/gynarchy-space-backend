import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
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
void bootstrap();
