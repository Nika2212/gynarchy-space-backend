import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { MediaController } from './core/controllers/media.controller';
import { MediaService } from './core/services/media.service';
import { XMDCentre } from './centres/XMD.centre';
import { DatabaseModule } from './database.module';

@Module({
  imports: [
    HttpModule.register({
      maxRedirects: 5,
      timeout: 6000,
    }),
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DatabaseModule,
  ],
  controllers: [
    MediaController,
  ],
  providers: [
    XMDCentre,
    MediaService,
    // StorageService,
  ],
})
export class AppModule {
}
