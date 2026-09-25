import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

export let AppConfigProcess: ConfigService;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  AppConfigProcess = app.get(ConfigService);

  app.setGlobalPrefix('api');

  const port = Number(AppConfigProcess.get<string>('PORT')) || 3000;
  await app.listen(port);
}
void bootstrap();