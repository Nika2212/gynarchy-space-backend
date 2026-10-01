import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { XMDCentre } from '../core/centres/XMD.centre';
import { MediaRepository } from '../repositories/media.repository';
import { PER_PAGE_SIZE } from '../shared/paging';
import { decryptShortTokenToURL } from '../shared/url-token';
import { IMediaContainer } from '../shared/interfaces/media-container.interface';
import { IMediaInfo } from '../shared/interfaces/media-info.interface';
import { IMediaLibrary } from '../shared/interfaces/media-library.interface';
import { IMediaSnapshot } from '../shared/interfaces/media-snapshot.interface';
import { IMeta } from '../shared/interfaces/meta.interface';
import { IFindAll } from '../shared/interfaces/query.interface';

@Injectable()
export class MediaService {
  constructor(
    private readonly xmdCentre: XMDCentre,
    private readonly mediaRepository: MediaRepository,
  ) {}

  // Searches XMD and returns one page of results. Nothing is read from or written to the database.
  public async findAll(query: IFindAll): Promise<IMediaContainer> {
    const medias: IMediaInfo[] = await this.xmdCentre.search(query.keyword, query.page);
    const meta: IMeta = {
      currentPage: query.page,
      isLastPage: medias.length < PER_PAGE_SIZE,
    };

    return {
      medias,
      meta,
    };
  }

  // Returns every media the user has liked, favorited, downloaded, or started watching.
  public async findLibrary(): Promise<IMediaLibrary> {
    return {
      medias: await this.mediaRepository.findLibrary(),
    };
  }

  // Toggles liked after checking that the media id is a valid token.
  public async toggleLike(id: string, media: IMediaSnapshot) {
    this.assertMediaID(id);
    return this.mediaRepository.toggleLike(id, media);
  }

  // Toggles favorite after checking that the media id is a valid token.
  public async toggleFavorite(id: string, media: IMediaSnapshot) {
    this.assertMediaID(id);
    return this.mediaRepository.toggleFavorite(id, media);
  }

  // Saves playback position after checking that the media id and value are valid.
  public async saveWatchPosition(id: string, watchPositionAt: number, media: IMediaSnapshot) {
    this.assertMediaID(id);
    if (!Number.isFinite(watchPositionAt) || watchPositionAt < 0) {
      throw new BadRequestException('Invalid watchPositionAt');
    }
    return this.mediaRepository.saveWatchPosition(id, watchPositionAt, media);
  }

  // Rejects ids that are empty or do not decode to an origin URL.
  private assertMediaID(id: string): void {
    if (!id || !decryptShortTokenToURL(id)) {
      throw new NotFoundException('Invalid media id');
    }
  }
}
