import { Body, Controller, Headers, HttpCode, HttpStatus, Ip, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PasscodeDTO } from '../DTOs/passcode.DTO';
import { SecurityService } from '../services/security.service';
import { IAuth } from '../shared/interfaces/auth.interface';

// Sent by the app: "standalone" when it runs from the home screen, "browser" otherwise.
const DISPLAY_MODE_HEADER = 'x-display-mode';

@Controller('security')
export class SecurityController {
  constructor(private readonly securityService: SecurityService) {}

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('passcode')
  @HttpCode(HttpStatus.OK)
  // Checks the passcode and device and returns a JWT when both pass. Wrong tries are counted per client IP.
  public async passcode(
    @Body() body: PasscodeDTO,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Headers(DISPLAY_MODE_HEADER) displayMode: string | undefined,
  ): Promise<IAuth> {
    return this.securityService.auth(body.passcode, ip, { userAgent, displayMode });
  }
}
