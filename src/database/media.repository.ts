import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { encryptText, hashIdentifier, tryDecryptText } from '../common/field-crypto';
import { decryptShortTokenToURL } from '../common/url-token';
import type { IMediaInfo } from '../interfaces/media-info.interface';
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

  // Creates the media row if needed, then flips the named boolean flag.
  private async toggleFlag(
    identifier: string,
    flag: 'isLiked' | 'isFavorite' | 'isHidden',
  ): Promise<MediaFlags> {
    const secret = this.secret();
    const identifierHash = hashIdentifier(identifier, secret);
    const existing = await this.mediaModel.findOne({ identifierHash }).exec();

    if (!existing) {
      const created = await this.mediaModel.create({
        identifierHash,
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
        [flag]: true,
        lastSeenAt: new Date(),
      });
      return this.toFlags(created, secret)!;
    }

    existing[flag] = !existing[flag];
    await existing.save();
    return this.toFlags(existing, secret)!;
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
