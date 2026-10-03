import { Body, Controller, Delete, Get, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SecurityGuard } from '../core/security.guard';
import { AlbumNameDTO } from '../DTOs/album-name.DTO';
import { MediaFlagDTO } from '../DTOs/media-flag.DTO';
import { AlbumService } from '../services/album.service';

@UseGuards(ThrottlerGuard, SecurityGuard)
@Throttle({ default: { limit: 120, ttl: 60000 } })
@Controller('albums')
export class AlbumsController {
  constructor(private readonly albumService: AlbumService) {}

  @Get()
  // Returns every album with its media.
  public async findAll(@Res() res: Response): Promise<void> {
    res.status(200).json(await this.albumService.findAll());
  }

  @Post()
  public async create(@Res() res: Response, @Body() body: AlbumNameDTO): Promise<void> {
    res.status(201).json(await this.albumService.create(body.name));
  }

  @Patch(':id')
  public async rename(@Param('id') id: string, @Res() res: Response, @Body() body: AlbumNameDTO): Promise<void> {
    res.status(200).json(await this.albumService.rename(id, body.name));
  }

  @Delete(':id')
  public async delete(@Param('id') id: string, @Res() res: Response): Promise<void> {
    await this.albumService.delete(id);
    res.status(204).send();
  }

  @Post(':id/medias/:mediaId')
  // Adds a media to the album with its card.
  public async addMedia(@Param('id') id: string, @Param('mediaId') mediaID: string, @Res() res: Response, @Body() body: MediaFlagDTO): Promise<void> {
    res.status(200).json(await this.albumService.addMedia(id, mediaID, body.media));
  }

  @Delete(':id/medias/:mediaId')
  public async removeMedia(@Param('id') id: string, @Param('mediaId') mediaID: string, @Res() res: Response): Promise<void> {
    res.status(200).json(await this.albumService.removeMedia(id, mediaID));
  }
}
