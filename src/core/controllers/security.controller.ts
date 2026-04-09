import { Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { SecurityService } from '../services/security.service';
import type { Request, Response } from 'express';
import { IAuth } from '../../interfaces/auth.interface';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

@Controller('security')
export class SecurityController {
  constructor(private readonly securityService: SecurityService) {}

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 6, ttl: 60000 } })
  @Post('passcode')
  public async passcode(@Req() req: Request, @Res() res: Response): Promise<void> {
    const accessToken: IAuth = await this.securityService.auth(req.body.passcode);

    res.json(accessToken);
  }
}