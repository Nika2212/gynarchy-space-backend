import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Req,
  Res
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { IFindAll } from '../../interfaces/query.interface';

@Controller('media')
export class MediaController {
  @Get()
  public async findAll(@Req() req: Request, @Res() res: Response): Promise<void> {
    const query: IFindAll = req.query as unknown as IFindAll;

    res.status(200).json({ message: 'This action returns all media' });
  }

  @Get(':id')
  public async findOne(@Req() req: Request, @Res() res: Response): Promise<void> {
    const { id } = req.params;

    res.status(200).json({ message: `This action returns media #${id}` });
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