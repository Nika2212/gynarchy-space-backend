import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { XMDCentre } from './centres/XMD.centre';

export let AppConfigProcess: ConfigService;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  AppConfigProcess = app.get(ConfigService);

  await app.listen(process.env.PORT ?? 3000);

  const XMDInstance = new XMDCentre();
        XMDInstance.search('gynarchy', 1).then((data) => console.log(data));
        XMDInstance.getUrl('https://www.xmegadrive.com/videos/mistress-courtneys-fetish-lair-puppy-training/').then((data) => console.log(data));
}
void bootstrap();