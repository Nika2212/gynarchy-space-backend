import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { SecurityService } from '../services/security.service';
import { IAuth } from '../../interfaces/auth.interface';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PasscodeDto } from '../dto/passcode.dto';

@Controller('security')
export class SecurityController {
  constructor(private readonly securityService: SecurityService) {}

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 6, ttl: 60000 } })
  @Post('passcode')
  @HttpCode(HttpStatus.OK)
  public async passcode(@Body() body: PasscodeDto): Promise<IAuth> {
    return this.securityService.auth(body.passcode);
  }
}
