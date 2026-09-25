import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import { HealthController } from './controllers/health.controller';
import { ImagesController } from './controllers/images.controller';
import { MediaController } from './controllers/media.controller';
import { SecurityController } from './controllers/security.controller';
import { XMDCentre } from './core/centres/XMD.centre';
import { SecurityGuard } from './core/security.guard';
import { MediaRepository } from './repositories/media.repository';
import { MediaDocument, MediaSchema } from './repositories/media.schema';
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
    MongooseModule.forFeature([{ name: MediaDocument.name, schema: MediaSchema }]),
  ],
  controllers: [HealthController, SecurityController, MediaController, ImagesController],
  providers: [
    SecurityService,
    SecurityGuard,
    XMDCentre,
    MediaService,
    MediaStreamService,
    ImageProxyService,
    MediaRepository,
  ],
})
export class AppModule {}
