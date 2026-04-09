import { Injectable } from '@nestjs/common';
import { PER_PAGE_SIZE, XMDCentre } from '../../centres/XMD.centre';
import { IFindAll } from '../../interfaces/query.interface';
import { IMediaContainer } from '../../interfaces/media-container.interface';
import { IMediaInfo } from '../../interfaces/media-info.interface';
import { IMeta } from '../../interfaces/meta.interface';

@Injectable()
export class MediaService {
  constructor(private readonly xmdCentre: XMDCentre) {}

  public async findAll(query: IFindAll): Promise<IMediaContainer> {
    const medias: IMediaInfo[] = await this.xmdCentre.search(query.keyword, query.page);
    const meta: IMeta = {
      currentPage: query.page,
      isLastPage: medias.length < PER_PAGE_SIZE,
    };

    return {
      medias,
      meta
    };
  }
}