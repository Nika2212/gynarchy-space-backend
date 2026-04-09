import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MediaController } from './core/controllers/media.controller';
import { MediaService } from './core/services/media.service';
import { XMDCentre } from './centres/XMD.centre';
import { DatabaseModule } from './database.module';
import { SecurityGuard, SecurityService } from './core/services/security.service';
import { JwtModule } from '@nestjs/jwt';
import { SecurityController } from './core/controllers/security.controller';
import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    HttpModule.register({
      maxRedirects: 5,
      timeout: 6000,
    }),
    ConfigModule.forRoot({
      isGlobal: true,
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
  controllers: [MediaController, SecurityController],
  providers: [SecurityService, SecurityGuard, XMDCentre, MediaService],
})
export class AppModule {}
