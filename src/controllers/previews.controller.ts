import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { MediaStreamService } from '../services/media-stream.service';

@UseGuards(ThrottlerGuard)
// Every visible feed card with a preview streams it, and Range requests split one preview into several hits, so the limit is high.
@Throttle({ default: { limit: 1200, ttl: 60000 } })
@Controller('previews')
export class PreviewsController {
  constructor(private readonly mediaStreamService: MediaStreamService) {}

  @Get(':id')
  // Streams a card's short preview video by its short token id. Public so a <video src> tag can play it.
  public async findOne(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.mediaStreamService.preview(req.params.id as string, req.headers.range as string, res);
  }
}
