import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { encryptText, hashIdentifier, tryDecryptText } from '../shared/field-crypto';
import { parsePage, PER_PAGE_SIZE } from '../shared/paging';
import { decryptShortTokenToURL } from '../shared/url-token';
import type { IMediaInfo } from '../shared/interfaces/media-info.interface';
import { MediaDocument } from './media.schema';

export type MediaFlags = Pick<
  MediaDocument,
  | 'identifier'
  | 'isLiked'
  | 'isFavorite'
  | 'isHidden'
  | 'watchedAt'
  | 'watchedTimes'
  | 'watchPositionAt'
>;

const FLAG_DEFAULTS = {
  isLiked: false,
  isFavorite: false,
  isHidden: false,
  watchedTimes: 0,
  watchedAt: null,
  watchPositionAt: null,
} as const;

@Injectable()
export class MediaRepository {
  constructor(
    @InjectModel(MediaDocument.name) private readonly mediaModel: Model<MediaDocument>,
    private readonly configService: ConfigService,
  ) {}

  // Loads like, favorite, hidden, and watch flags for the given identifiers.
  public async findByIdentifiers(identifiers: readonly string[]): Promise<MediaFlags[]> {
    if (identifiers.length === 0) {
      return [];
    }

    const secret = this.secret();
    const hashes = identifiers.map((identifier) => hashIdentifier(identifier, secret));
    const rows = await this.mediaModel
      .find({ identifierHash: { $in: hashes } })
      .select('identifier isLiked isFavorite isHidden watchedAt watchedTimes watchPositionAt')
      .exec();

    return rows
      .map((row) => this.toFlags(row, secret))
      .filter((row): row is MediaFlags => row !== undefined);
  }

  // Loads one page of liked or favorited catalog rows, newest updates first.
  public async findByFlag(
    flag: 'isLiked' | 'isFavorite',
    page: number,
  ): Promise<{ medias: IMediaInfo[]; total: number }> {
    const secret = this.secret();
    const currentPage = parsePage(page);
    const filter = { [flag]: true };
    const skip = (currentPage - 1) * PER_PAGE_SIZE;
    const [rows, total] = await Promise.all([
      this.mediaModel.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(PER_PAGE_SIZE).exec(),
      this.mediaModel.countDocuments(filter).exec(),
    ]);

    return {
      medias: rows
        .map((row) => this.toMediaInfo(row, secret))
        .filter((media): media is IMediaInfo => media !== undefined),
      total,
    };
  }

  // Saves or refreshes catalog fields from a search, without overwriting user flags.
  public async upsertFromSearch(medias: readonly IMediaInfo[]): Promise<void> {
    const secret = this.secret();
    const ops = medias
      .filter((media): media is IMediaInfo & { identifier: string } => Boolean(media.identifier))
      .map((media) => {
        const catalog = this.encryptCatalog(media, secret);
        return {
          updateOne: {
            filter: { identifierHash: hashIdentifier(media.identifier, secret) },
            update: {
              $set: {
                ...catalog,
                lastSeenAt: new Date(),
              },
              $setOnInsert: { ...FLAG_DEFAULTS },
            },
            upsert: true,
          },
        };
      });

    if (ops.length === 0) {
      return;
    }

    await this.mediaModel.bulkWrite(ops, { ordered: false });
  }

  // Flips the liked flag for one media item.
  public async toggleLike(identifier: string): Promise<MediaFlags> {
    return this.toggleFlag(identifier, 'isLiked');
  }

  // Flips the favorite flag for one media item.
  public async toggleFavorite(identifier: string): Promise<MediaFlags> {
    return this.toggleFlag(identifier, 'isFavorite');
  }

  // Flips the hidden flag for one media item.
  public async toggleHidden(identifier: string): Promise<MediaFlags> {
    return this.toggleFlag(identifier, 'isHidden');
  }

  // Writes the playback position and last-watched time for one media item.
  public async saveWatchPosition(identifier: string, watchPositionAt: number): Promise<MediaFlags> {
    const secret = this.secret();
    const identifierHash = hashIdentifier(identifier, secret);
    const existing = await this.mediaModel.findOne({ identifierHash }).exec();
    const watchedAt = new Date();

    if (!existing) {
      const created = await this.createMissing(identifier, secret, {
        watchPositionAt,
        watchedAt,
        lastSeenAt: watchedAt,
      });
      return this.toFlags(created, secret)!;
    }

    existing.watchPositionAt = watchPositionAt;
    existing.watchedAt = watchedAt;
    await existing.save();
    return this.toFlags(existing, secret)!;
  }

  // Creates the media row if needed, then flips the named boolean flag.
  private async toggleFlag(
    identifier: string,
    flag: 'isLiked' | 'isFavorite' | 'isHidden',
  ): Promise<MediaFlags> {
    const secret = this.secret();
    const identifierHash = hashIdentifier(identifier, secret);
    const existing = await this.mediaModel.findOne({ identifierHash }).exec();

    if (!existing) {
      const created = await this.createMissing(identifier, secret, { [flag]: true });
      return this.toFlags(created, secret)!;
    }

    existing[flag] = !existing[flag];
    await existing.save();
    return this.toFlags(existing, secret)!;
  }

  // Creates a catalog stub for a media id that has not been searched yet.
  private async createMissing(
    identifier: string,
    secret: string,
    extras: Partial<MediaDocument>,
  ): Promise<MediaDocument> {
    return this.mediaModel.create({
      identifierHash: hashIdentifier(identifier, secret),
      ...this.encryptCatalog(
        {
          identifier,
          url: decryptShortTokenToURL(identifier) ?? `/media/${identifier}`,
          title: '',
          description: '',
          thumbnailSrc: [],
          postedAt: '',
          duration: 0,
        },
        secret,
      ),
      ...FLAG_DEFAULTS,
      lastSeenAt: new Date(),
      ...extras,
    });
  }

  // Encrypts catalog text and URL fields before they are stored.
  private encryptCatalog(
    media: Pick<IMediaInfo, 'identifier' | 'url' | 'title' | 'description' | 'thumbnailSrc' | 'postedAt' | 'duration'>,
    secret: string,
  ) {
    return {
      identifier: encryptText(media.identifier ?? '', secret),
      url: encryptText(media.url, secret),
      title: encryptText(media.title, secret),
      description: encryptText(media.description ?? '', secret),
      thumbnailSrc: encryptText(JSON.stringify(media.thumbnailSrc ?? []), secret),
      postedAt: encryptText(media.postedAt ?? '', secret),
      duration: media.duration ?? 0,
      source: 'xmd',
    };
  }

  // Decrypts catalog fields into the public media card shape.
  private toMediaInfo(row: MediaDocument, secret: string): IMediaInfo | undefined {
    const identifier = tryDecryptText(row.identifier, secret);
    if (!identifier) {
      return undefined;
    }

    return {
      identifier,
      url: `/media/${identifier}`,
      title: tryDecryptText(row.title, secret) ?? '',
      description: tryDecryptText(row.description, secret) ?? '',
      postedAt: tryDecryptText(row.postedAt, secret) ?? '',
      duration: row.duration ?? 0,
      thumbnailSrc: this.parseThumbnailSrc(tryDecryptText(row.thumbnailSrc, secret)),
      isLiked: row.isLiked,
      isFavorite: row.isFavorite,
      isHidden: row.isHidden,
      watchedAt: row.watchedAt ?? undefined,
      watchedTimes: row.watchedTimes ?? 0,
      watchPositionAt: row.watchPositionAt ?? undefined,
    };
  }

  // Parses stored thumbnail JSON into a string array, or empty on corrupt data.
  private parseThumbnailSrc(raw: string | undefined): string[] {
    if (!raw) {
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
        return parsed;
      }
    } catch {
      return [];
    }

    return [];
  }

  // Decrypts the identifier and maps the row to public flag fields.
  private toFlags(row: MediaDocument, secret: string): MediaFlags | undefined {
    const identifier = tryDecryptText(row.identifier, secret);
    if (!identifier) {
      return undefined;
    }

    return {
      identifier,
      isLiked: row.isLiked,
      isFavorite: row.isFavorite,
      isHidden: row.isHidden,
      watchedAt: row.watchedAt ?? null,
      watchedTimes: row.watchedTimes ?? 0,
      watchPositionAt: row.watchPositionAt ?? null,
    };
  }

  // Returns the JWT secret used as the field-encryption key.
  private secret(): string {
    return this.configService.getOrThrow<string>('JWT_SECRET');
  }
}
