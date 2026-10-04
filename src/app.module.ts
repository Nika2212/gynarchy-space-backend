import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import { AlbumsController } from './controllers/albums.controller';
import { HealthController } from './controllers/health.controller';
import { ImagesController } from './controllers/images.controller';
import { MediaController } from './controllers/media.controller';
import { PreviewsController } from './controllers/previews.controller';
import { SecurityController } from './controllers/security.controller';
import { BaseCentre } from './core/centres/base.centre';
import { CENTRES, CentreRegistry } from './core/centres/centre.registry';
import { HFCentre } from './core/centres/HF.centre';
import { XMDCentre } from './core/centres/XMD.centre';
import { SecurityGuard } from './core/security.guard';
import { AlbumRepository } from './repositories/album.repository';
import { AlbumDocument, AlbumSchema } from './repositories/album.schema';
import { MediaRepository } from './repositories/media.repository';
import { MediaDocument, MediaSchema } from './repositories/media.schema';
import { AlbumService } from './services/album.service';
import { ImageProxyService } from './services/image-proxy.service';
import { MediaStreamService } from './services/media-stream.service';
import { MediaService } from './services/media.service';
import { SecurityService } from './services/security.service';
import { validateEnv } from './shared/config/env.validation';

// Configures JWT signing from JWT_SECRET with a 7-day lifetime.
export async function jwtOptions(configService: ConfigService) {
  return {
    secret: configService.get<string>('JWT_SECRET'),
    signOptions: { expiresIn: '7d' as const },
  };
}

// Builds the Atlas connection from MONGODB_URI.
export function mongoOptions(configService: ConfigService) {
  return {
    uri: configService.getOrThrow<string>('MONGODB_URI'),
    dbName: 'gynarchy',
    serverSelectionTimeoutMS: 10_000,
  };
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: '.env',
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot([
      {
        limit: 512,
        ttl: 30000,
        blockDuration: 30000,
      },
    ]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: jwtOptions,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: mongoOptions,
    }),
    MongooseModule.forFeature([
      { name: MediaDocument.name, schema: MediaSchema },
      { name: AlbumDocument.name, schema: AlbumSchema },
    ]),
  ],
  controllers: [HealthController, SecurityController, MediaController, ImagesController, PreviewsController, AlbumsController],
  providers: [
    SecurityService,
    SecurityGuard,
    XMDCentre,
    HFCentre,
    {
      provide: CENTRES,
      inject: [XMDCentre, HFCentre],
      useFactory: (...centres: BaseCentre[]) => centres,
    },
    CentreRegistry,
    MediaService,
    MediaStreamService,
    ImageProxyService,
    MediaRepository,
    AlbumService,
    AlbumRepository,
  ],
})
export class AppModule {}
