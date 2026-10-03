import { Body, Controller, Delete, Get, Patch, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../core/public.decorator';
import { SecurityGuard } from '../core/security.guard';
import { MediaFlagDTO } from '../DTOs/media-flag.DTO';
import { WatchPositionDTO } from '../DTOs/watch-position.DTO';
import { MediaStreamService } from '../services/media-stream.service';
import { MediaService } from '../services/media.service';
import { parsePage } from '../shared/paging';
import { IMediaContainer } from '../shared/interfaces/media-container.interface';
import { IMediaLibrary } from '../shared/interfaces/media-library.interface';
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
    query.page = parsePage(query.page);
    const payload: IMediaContainer = await this.mediaService.findAll(query);

    res.status(200).json(payload);
  }

  @Get('library')
  // Returns every media the user has liked, favorited, downloaded, or started watching.
  public async findLibrary(@Res() res: Response): Promise<void> {
    const payload: IMediaLibrary = await this.mediaService.findLibrary();
    res.status(200).json(payload);
  }

  @Delete('history')
  // Clears the whole watch history; liked, favorited, and downloaded media stay in the library.
  public async clearAllWatchHistory(@Res() res: Response): Promise<void> {
    await this.mediaService.clearAllWatchHistory();
    res.status(204).send();
  }

  @Get(':id')
  @Public()
  @Throttle({ default: { limit: 300, ttl: 60000 } })
  // Streams the video for one media id. Public so a <video src> tag can play it.
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

  @Patch(':id/favorite')
  // Toggles the favorite flag for one media item and stores its card.
  public async favorite(@Req() req: Request, @Res() res: Response, @Body() body: MediaFlagDTO): Promise<void> {
    const payload = await this.mediaService.toggleFavorite(req.params.id as string, body.media);
    res.status(200).json(payload);
  }

  @Patch(':id/like')
  // Toggles the liked flag for one media item and stores its card.
  public async like(@Req() req: Request, @Res() res: Response, @Body() body: MediaFlagDTO): Promise<void> {
    const payload = await this.mediaService.toggleLike(req.params.id as string, body.media);
    res.status(200).json(payload);
  }

  @Delete(':id/watch-history')
  // Removes one media from the watch history.
  public async clearWatchHistory(@Req() req: Request, @Res() res: Response): Promise<void> {
    const payload = await this.mediaService.clearWatchHistory(req.params.id as string);
    res.status(200).json(payload);
  }

  @Patch(':id/watch-position')
  // Saves the playback position (milliseconds) for one media item and stores its card.
  public async saveWatchPosition(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: WatchPositionDTO,
  ): Promise<void> {
    const payload = await this.mediaService.saveWatchPosition(
      req.params.id as string,
      body.watchPositionAt,
      body.media,
    );
    res.status(200).json(payload);
  }
}
