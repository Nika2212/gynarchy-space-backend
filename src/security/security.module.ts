import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { SecurityController } from './security.controller';
import { SecurityGuard } from './security.guard';
import { SecurityService } from './security.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      // Configures JWT signing from JWT_SECRET with a 7-day lifetime.
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [SecurityController],
  providers: [SecurityService, SecurityGuard],
  exports: [SecurityService, SecurityGuard, JwtModule],
})
export class SecurityModule {}
