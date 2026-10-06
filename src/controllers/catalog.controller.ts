import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SecurityGuard } from '../core/security.guard';
import { CatalogService } from '../services/catalog.service';
import { IMediaContainer } from '../shared/interfaces/media-container.interface';
import { IFindAll } from '../shared/interfaces/query.interface';
import { parsePage } from '../shared/paging';

@UseGuards(ThrottlerGuard, SecurityGuard)
@Throttle({ default: { limit: 120, ttl: 60000 } })
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  // Returns one page of catalog search results. Separate from the live centre search on GET /media.
  public async search(@Req() req: Request, @Res() res: Response): Promise<void> {
    const query: IFindAll = req.query as unknown as IFindAll;
    query.page = parsePage(query.page);
    const payload: IMediaContainer = await this.catalogService.search(query);

    res.status(200).json(payload);
  }
}
