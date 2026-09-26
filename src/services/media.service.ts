import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PER_PAGE_SIZE, XMDCentre } from '../core/centres/XMD.centre';
import { MediaRepository } from '../repositories/media.repository';
import { decryptShortTokenToURL } from '../shared/url-token';
import { IMediaContainer } from '../shared/interfaces/media-container.interface';
import { IMediaInfo } from '../shared/interfaces/media-info.interface';
import { IMeta } from '../shared/interfaces/meta.interface';
import { IFindAll } from '../shared/interfaces/query.interface';

@Injectable()
export class MediaService {
  constructor(
    private readonly xmdCentre: XMDCentre,
    private readonly mediaRepository: MediaRepository,
  ) {}

  // Searches XMD, upserts catalog rows, and returns results with stored flags.
  public async findAll(query: IFindAll): Promise<IMediaContainer> {
    const medias: IMediaInfo[] = await this.xmdCentre.search(query.keyword, query.page);
    await this.mediaRepository.upsertFromSearch(medias);
    const rows = await this.mediaRepository.findByIdentifiers(
      medias.map((media) => media.identifier).filter((id): id is string => Boolean(id)),
    );
    const byID = new Map(rows.map((row) => [row.identifier, row]));

    const meta: IMeta = {
      currentPage: query.page,
      isLastPage: medias.length < PER_PAGE_SIZE,
    };

    return {
      medias: medias.map((media) => {
        const row = media.identifier ? byID.get(media.identifier) : undefined;
        return {
          ...media,
          isLiked: row?.isLiked ?? false,
          isFavorite: row?.isFavorite ?? false,
          isHidden: row?.isHidden ?? false,
          watchedAt: row?.watchedAt ?? undefined,
          watchedTimes: row?.watchedTimes ?? 0,
          watchPositionAt: row?.watchPositionAt ?? undefined,
        };
      }),
      meta,
    };
  }

  // Returns stored liked items with catalog fields and paging meta.
  public async findLiked(page: number): Promise<IMediaContainer> {
    return this.findFlagged('isLiked', page);
  }

  // Returns stored favorited items with catalog fields and paging meta.
  public async findFavorites(page: number): Promise<IMediaContainer> {
    return this.findFlagged('isFavorite', page);
  }

  // Toggles liked after checking that the media id is a valid token.
  public async toggleLike(id: string) {
    this.assertMediaID(id);
    return this.mediaRepository.toggleLike(id);
  }

  // Toggles favorite after checking that the media id is a valid token.
  public async toggleFavorite(id: string) {
    this.assertMediaID(id);
    return this.mediaRepository.toggleFavorite(id);
  }

  // Toggles hidden after checking that the media id is a valid token.
  public async toggleHidden(id: string) {
    this.assertMediaID(id);
    return this.mediaRepository.toggleHidden(id);
  }

  // Saves playback position after checking that the media id and value are valid.
  public async saveWatchPosition(id: string, watchPositionAt: number) {
    this.assertMediaID(id);
    if (!Number.isFinite(watchPositionAt) || watchPositionAt < 0) {
      throw new BadRequestException('Invalid watchPositionAt');
    }
    return this.mediaRepository.saveWatchPosition(id, watchPositionAt);
  }

  // Loads one flag collection page and builds the search-shaped container.
  private async findFlagged(
    flag: 'isLiked' | 'isFavorite',
    page: number,
  ): Promise<IMediaContainer> {
    const currentPage = Number.isInteger(page) && page > 0 ? page : 1;
    const { medias, total } = await this.mediaRepository.findByFlag(flag, currentPage);
    return {
      medias,
      meta: {
        currentPage,
        isLastPage: currentPage * PER_PAGE_SIZE >= total,
      },
    };
  }

  // Rejects ids that are empty or do not decode to an origin URL.
  private assertMediaID(id: string): void {
    if (!id || !decryptShortTokenToURL(id)) {
      throw new NotFoundException('Invalid media id');
    }
  }
}
