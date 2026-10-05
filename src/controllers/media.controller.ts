import { Body, Controller, Delete, Get, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../core/public.decorator';
import { SecurityGuard } from '../core/security.guard';
import { DownloadDTO } from '../DTOs/download.DTO';
import { MediaFlagDTO } from '../DTOs/media-flag.DTO';
import { WatchPositionDTO } from '../DTOs/watch-position.DTO';
import { DownloadService } from '../services/download.service';
import { MediaStreamService } from '../services/media-stream.service';
import { MediaService } from '../services/media.service';
import { parsePage } from '../shared/paging';
import { IDownloadJob, IDownloadSnapshot } from '../shared/interfaces/download.interface';
import { IMediaContainer } from '../shared/interfaces/media-container.interface';
import { IMediaLibrary } from '../shared/interfaces/media-library.interface';
import { IMediaPlayback } from '../shared/interfaces/media-playback.interface';
import { IFindAll } from '../shared/interfaces/query.interface';

@UseGuards(ThrottlerGuard, SecurityGuard)
@Throttle({ default: { limit: 120, ttl: 60000 } })
@Controller('media')
export class MediaController {
  constructor(
    private readonly mediaService: MediaService,
    private readonly mediaStreamService: MediaStreamService,
    private readonly downloadService: DownloadService,
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

  @Get('downloads')
  // Returns active and failed downloads with the storage usage, the same data the socket sends on connect.
  public async findDownloads(@Res() res: Response): Promise<void> {
    const payload: IDownloadSnapshot = this.downloadService.snapshot();
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
  // A player sends many Range requests (iOS restarts one on every seek), so the limit is high and a burst over it is refused
  // for a second only, instead of freezing playback for the global block duration.
  @Throttle({ default: { limit: 600, ttl: 60000, blockDuration: 1000 } })
  // Streams the video for one media id. Public so a <video src> tag can play it.
  public async findOne(@Req() req: Request, @Res() res: Response): Promise<void> {
    const { id } = req.params;
    const range = req.headers.range as string;

    // ?source=origin streams from the original site even when a stored copy exists (storage unavailable).
    return this.mediaStreamService.stream(id as string, range, res, req.query.source === 'origin');
  }

  @Get(':id/playback')
  // Signed storage link of a downloaded media, so the player streams straight from storage instead of being redirected
  // through this API on every Range request. No link when the media is not downloaded or storage refuses it right now.
  public async findPlayback(@Req() req: Request, @Res() res: Response): Promise<void> {
    const payload: IMediaPlayback = await this.downloadService.playback(req.params.id as string);
    res.status(200).json(payload);
  }

  @Post(':id/download')
  // Queues the video for download to storage; progress is pushed over the downloads socket.
  public async download(@Req() req: Request, @Res() res: Response, @Body() body: DownloadDTO): Promise<void> {
    const job: IDownloadJob = await this.downloadService.start(req.params.id as string, body.media);
    res.status(202).json(job);
  }

  @Delete(':id/download')
  // Cancels an active download, dismisses a failed one, or deletes the stored copy.
  public async removeDownload(@Req() req: Request, @Res() res: Response): Promise<void> {
    const flags = await this.downloadService.remove(req.params.id as string);

    if (flags) {
      res.status(200).json(flags);
    } else {
      res.status(204).send();
    }
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
