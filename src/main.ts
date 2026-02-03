import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

export let AppConfigProcess: ConfigService;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  AppConfigProcess = app.get(ConfigService);

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();