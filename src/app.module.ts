import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MediaController } from './core/controllers/media.controller';
import { ImagesController } from './core/controllers/images.controller';
import { MediaService } from './core/services/media.service';
import { XMDCentre } from './centres/XMD.centre';
import { SecurityGuard, SecurityService } from './core/services/security.service';
import { JwtModule } from '@nestjs/jwt';
import { SecurityController } from './core/controllers/security.controller';
import { HealthController } from './core/controllers/health.controller';
import { ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: '.env',
      validate: validateEnv,
    }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
      inject: [ConfigService],
    }),
    ThrottlerModule.forRoot([{
      limit: 512,
      ttl: 30000,
      blockDuration: 30000
    }]),
    DatabaseModule,
  ],
  controllers: [HealthController, MediaController, ImagesController, SecurityController],
  providers: [SecurityService, SecurityGuard, XMDCentre, MediaService],
})
export class AppModule {}
