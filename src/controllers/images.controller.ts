import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ImageProxyService } from '../services/image-proxy.service';

@UseGuards(ThrottlerGuard)
// A feed card shows up to 5 thumbnails and fast scrolling passes many cards, so the limit is high; browsers cache each image for a day.
@Throttle({ default: { limit: 1200, ttl: 60000 } })
@Controller('images')
export class ImagesController {
  constructor(private readonly imageProxyService: ImageProxyService) {}

  @Get(':id')
  // Proxies a thumbnail image by its short token id.
  public async findOne(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.imageProxyService.proxy(req.params.id as string, res);
  }
}
