import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApp(app);

  const config = app.get(ConfigService);
  const port = Number(config.get<string>('PORT')) || 3000;
  await app.listen(port);
}
void bootstrap();
