import { Body, Controller, HttpCode, HttpStatus, Ip, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PasscodeDTO } from '../DTOs/passcode.DTO';
import { SecurityService } from '../services/security.service';
import { IAuth } from '../shared/interfaces/auth.interface';

@Controller('security')
export class SecurityController {
  constructor(private readonly securityService: SecurityService) {}

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('passcode')
  @HttpCode(HttpStatus.OK)
  // Checks the passcode and returns a JWT when it matches. Wrong tries are counted per client IP.
  public async passcode(@Body() body: PasscodeDTO, @Ip() ip: string): Promise<IAuth> {
    return this.securityService.auth(body.passcode, ip);
  }
}
