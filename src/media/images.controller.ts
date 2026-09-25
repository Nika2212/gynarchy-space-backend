import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ImageProxyService } from './image-proxy.service';

@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 180, ttl: 60000 } })
@Controller('images')
export class ImagesController {
  constructor(private readonly imageProxyService: ImageProxyService) {}

  @Get(':id')
  // Proxies a thumbnail image by its short token id.
  public async findOne(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.imageProxyService.proxy(req.params.id as string, res);
  }
}
