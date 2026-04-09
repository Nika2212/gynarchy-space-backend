import { Controller, Post, Req, Res } from '@nestjs/common';
import { SecurityService } from '../services/security.service';
import type { Request, Response } from 'express';
import { IAuth } from '../../interfaces/auth.interface';

@Controller('security')
export class SecurityController {
  constructor(
    private readonly securityService: SecurityService,
  ) {
  }

  @Post('passcode')
  public async passcode(@Req() req: Request, @Res() res: Response): Promise<void> {
    const accessToken: IAuth = await this.securityService.auth(req.body.passcode);

    res.json(accessToken);
  }
}