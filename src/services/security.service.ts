import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { safeEqual } from '../shared/timing-safe';

@Injectable()
export class SecurityService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // Compares the passcode and signs a JWT for a valid owner.
  public async auth(passcode: string) {
    const secretPasscode = this.configService.get<string>('APP_PASSCODE')?.trim() ?? '';

    if (!secretPasscode || !safeEqual(passcode, secretPasscode)) {
      throw new UnauthorizedException('Invalid passcode');
    }

    return {
      accessToken: await this.jwtService.signAsync({ sub: 'admin', role: 'owner' }),
    };
  }
}
