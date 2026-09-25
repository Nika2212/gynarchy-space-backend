import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { MediaService } from '../services/media.service';

@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 180, ttl: 60000 } })
@Controller('images')
export class ImagesController {
  constructor(private readonly mediaService: MediaService) {}

  @Get(':id')
  public async findOne(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.mediaService.findImage(req.params.id as string, res);
  }
}
