import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CentreRegistry } from '../core/centres/centre.registry';
import { MediaRepository } from '../repositories/media.repository';
import { decryptShortTokenToURL } from '../shared/url-token';
import { IMediaContainer } from '../shared/interfaces/media-container.interface';
import { IMediaLibrary } from '../shared/interfaces/media-library.interface';
import { IMediaSnapshot } from '../shared/interfaces/media-snapshot.interface';
import { IMeta } from '../shared/interfaces/meta.interface';
import { IFindAll } from '../shared/interfaces/query.interface';
import { CatalogService } from './catalog.service';

@Injectable()
export class MediaService {
  private readonly nativeSearch: boolean;

  constructor(
    private readonly centreRegistry: CentreRegistry,
    private readonly mediaRepository: MediaRepository,
    private readonly catalogService: CatalogService,
    configService: ConfigService,
  ) {
    this.nativeSearch = configService.get<string>('NATIVE_SEARCH')?.trim().toLowerCase() === 'true';
  }

  // NATIVE_SEARCH=true reads the catalog. Otherwise every centre is searched and nothing is read from the database.
  public async findAll(query: IFindAll): Promise<IMediaContainer> {
    if (this.nativeSearch) {
      return this.catalogService.search(query);
    }

    const { medias, isLastPage } = await this.centreRegistry.search(query.keyword, query.page);
    const meta: IMeta = {
      currentPage: query.page,
      isLastPage,
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

  // Removes one media from the watch history after checking the id; 404 when it is not in the library.
  public async clearWatchHistory(id: string) {
    this.assertMediaID(id);
    const flags = await this.mediaRepository.clearWatchHistory(id);
    if (!flags) {
      throw new NotFoundException('Media is not in the library');
    }
    return flags;
  }

  // Clears the whole watch history; liked, favorited, and downloaded media stay.
  public async clearAllWatchHistory(): Promise<void> {
    await this.mediaRepository.clearAllWatchHistory();
  }

  // Rejects ids that are empty or do not decode to an origin URL.
  private assertMediaID(id: string): void {
    if (!id || !decryptShortTokenToURL(id)) {
      throw new NotFoundException('Invalid media id');
    }
  }
}
