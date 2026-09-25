import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { MediaService } from '../services/media.service';

@Controller('images')
export class ImagesController {
  constructor(private readonly mediaService: MediaService) {}

  @Get(':id')
  public async findOne(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.mediaService.findImage(req.params.id as string, res);
  }
}
