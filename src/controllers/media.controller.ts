import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SecurityGuard } from '../core/security.guard';
import { MediaStreamService } from '../services/media-stream.service';
import { MediaService } from '../services/media.service';
import { isNumberedString } from '../shared/type-guards';
import { IMediaContainer } from '../shared/interfaces/media-container.interface';
import { IFindAll } from '../shared/interfaces/query.interface';

@UseGuards(ThrottlerGuard, SecurityGuard)
@Throttle({ default: { limit: 120, ttl: 60000 } })
@Controller('media')
export class MediaController {
  constructor(
    private readonly mediaService: MediaService,
    private readonly mediaStreamService: MediaStreamService,
  ) {}

  @Get()
  // Returns a search page of media items and paging meta.
  public async findAll(@Req() req: Request, @Res() res: Response): Promise<void> {
    const query: IFindAll = req.query as unknown as IFindAll;
    query.page = isNumberedString(query.page) ? +query.page : 1;
    const payload: IMediaContainer = await this.mediaService.findAll(query);

    res.status(200).json(payload);
  }

  @Get(':id')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  // Streams the video for one media id.
  public async findOne(@Req() req: Request, @Res() res: Response): Promise<void> {
    const { id } = req.params;
    const range = req.headers.range as string;

    return this.mediaStreamService.stream(id as string, range, res);
  }

  @Get(':id/download')
  // Placeholder download endpoint until file export is implemented.
  public async download(@Req() req: Request, @Res() res: Response): Promise<void> {
    const { id } = req.params;

    res.status(200).json({ message: `This action downloads media #${id}` });
  }

  @Get(':id/favorite')
  // Toggles the favorite flag for one media item.
  public async favorite(@Req() req: Request, @Res() res: Response): Promise<void> {
    const payload = await this.mediaService.toggleFavorite(req.params.id as string);
    res.status(200).json(payload);
  }

  @Get(':id/like')
  // Toggles the liked flag for one media item.
  public async like(@Req() req: Request, @Res() res: Response): Promise<void> {
    const payload = await this.mediaService.toggleLike(req.params.id as string);
    res.status(200).json(payload);
  }

  @Get(':id/hide')
  // Toggles the hidden flag for one media item.
  public async hide(@Req() req: Request, @Res() res: Response): Promise<void> {
    const payload = await this.mediaService.toggleHidden(req.params.id as string);
    res.status(200).json(payload);
  }
}
