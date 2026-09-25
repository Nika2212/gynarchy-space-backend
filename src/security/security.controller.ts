import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IAuth } from '../interfaces/auth.interface';
import { PasscodeDTO } from './passcode.DTO';
import { SecurityService } from './security.service';

@Controller('security')
export class SecurityController {
  constructor(private readonly securityService: SecurityService) {}

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 6, ttl: 60000 } })
  @Post('passcode')
  @HttpCode(HttpStatus.OK)
  // Checks the passcode and returns a JWT when it matches.
  public async passcode(@Body() body: PasscodeDTO): Promise<IAuth> {
    return this.securityService.auth(body.passcode);
  }
}
