import {
  Controller,
  Get,
  Req,
  Res
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { IFindAll } from '../../interfaces/query.interface';
import { IMediaContainer } from '../../interfaces/media-container.interface';
import { MediaService } from '../services/media.service';
import { isNumberedString } from '../helpers/utils';

@Controller('media')
export class MediaController {
  constructor(
    private readonly mediaService: MediaService) {
  }

  @Get()
  public async findAll(@Req() req: Request, @Res() res: Response): Promise<void> {
    const query: IFindAll = req.query as unknown as IFindAll;
          query.page = isNumberedString(query.page) ? +query.page : 1;
    const payload: IMediaContainer = await this.mediaService.findAll(query);

    res.status(200).json(payload);
  }

  @Get(':id')
  public async findOne(@Req() req: Request, @Res() res: Response): Promise<void> {
    const { id } = req.params;
    const range = req.headers.range as string;

    return await this.mediaService.find(id as string, range, res);
  }

  @Get(':id/download')
  public async download(@Req() req: Request, @Res() res: Response): Promise<void> {
    const { id } = req.params;

    res.status(200).json({ message: `This action downloads media #${id}` });
  }

  @Get(':id/favorite')
  public async favorite(@Req() req: Request, @Res() res: Response): Promise<void> {
    const { id } = req.params;

    res.status(200).json({ message: `This action removes the downloaded file for media #${id}` });
  }

  @Get(':id/like')
  public async like(@Req() req: Request, @Res() res: Response): Promise<void> {
    const { id } = req.params;

    res.status(200).json({ message: `This action likes media #${id}` });
  }
}