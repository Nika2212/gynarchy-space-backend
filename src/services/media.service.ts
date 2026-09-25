import { Injectable, NotFoundException } from '@nestjs/common';
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

  // Rejects ids that are empty or do not decode to an origin URL.
  private assertMediaID(id: string): void {
    if (!id || !decryptShortTokenToURL(id)) {
      throw new NotFoundException('Invalid media id');
    }
  }
}
