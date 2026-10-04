import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CentreRegistry } from '../core/centres/centre.registry';
import { encryptText, hashIdentifier, tryDecryptText } from '../shared/field-crypto';
import { decryptShortTokenToURL } from '../shared/url-token';
import type { IMediaInfo } from '../shared/interfaces/media-info.interface';
import type { IMediaSnapshot } from '../shared/interfaces/media-snapshot.interface';
import { MediaDocument } from './media.schema';

export type MediaFlags = Pick<
  MediaDocument,
  | 'identifier'
  | 'isLiked'
  | 'isFavorite'
  | 'isDownloaded'
  | 'watchedAt'
  | 'watchedTimes'
  | 'watchPositionAt'
>;

type MediaFlag = 'isLiked' | 'isFavorite';

const FLAG_DEFAULTS = {
  isLiked: false,
  isFavorite: false,
  isDownloaded: false,
  watchedTimes: 0,
  watchedAt: null,
  watchPositionAt: null,
} as const;

const FLAG_DATES = {
  isLiked: 'likedAt',
  isFavorite: 'favoritedAt',
} as const;

// A save this long after the previous one counts as a new viewing (watchedTimes goes up).
const WATCH_SESSION_GAP_MS = 30 * 60 * 1000;

const HISTORY_RESET = {
  watchedAt: null,
  watchedTimes: 0,
  watchPositionAt: null,
} as const;

// Rows the user still cares about. Older rows saved by searches (no flags, no progress) are left out.
const LIBRARY_FILTER = {
  $or: [{ isLiked: true }, { isFavorite: true }, { isDownloaded: true }, { watchPositionAt: { $ne: null } }],
};

@Injectable()
export class MediaRepository {
  constructor(
    @InjectModel(MediaDocument.name) private readonly mediaModel: Model<MediaDocument>,
    private readonly configService: ConfigService,
    private readonly centreRegistry: CentreRegistry,
  ) {}

  // Loads every stored media with its flags, most recently changed first.
  public async findLibrary(): Promise<IMediaInfo[]> {
    const secret = this.secret();
    const rows = await this.mediaModel.find(LIBRARY_FILTER).sort({ updatedAt: -1 }).exec();

    return rows
      .map((row) => this.toMediaInfo(row, secret))
      .filter((media): media is IMediaInfo => media !== undefined);
  }

  // Flips the liked flag for one media item.
  public async toggleLike(identifier: string, media: IMediaSnapshot): Promise<MediaFlags> {
    return this.toggleFlag(identifier, 'isLiked', media);
  }

  // Flips the favorite flag for one media item.
  public async toggleFavorite(identifier: string, media: IMediaSnapshot): Promise<MediaFlags> {
    return this.toggleFlag(identifier, 'isFavorite', media);
  }

  // Writes the playback position and last-watched time for one media item. The first save of a viewing counts it in watchedTimes.
  public async saveWatchPosition(identifier: string, watchPositionAt: number, media: IMediaSnapshot): Promise<MediaFlags> {
    const secret = this.secret();
    const identifierHash = hashIdentifier(identifier, secret);
    const existing = await this.mediaModel.findOne({ identifierHash }).exec();
    const watchedAt = new Date();

    if (!existing) {
      const created = await this.create(identifier, media, secret, { watchPositionAt, watchedAt, watchedTimes: 1 });
      return this.toFlags(created, secret)!;
    }

    const watchedTimes = (existing.watchedTimes ?? 0) + (this.isNewViewing(existing.watchedAt, watchedAt) ? 1 : 0);

    Object.assign(existing, this.encryptCatalog(identifier, media, secret), { watchPositionAt, watchedAt, watchedTimes });
    await existing.save();
    return this.toFlags(existing, secret)!;
  }

  // Removes one media from the watch history. The row stays while it is liked, favorited, or downloaded. Null when it was not stored.
  public async clearWatchHistory(identifier: string): Promise<MediaFlags | null> {
    const secret = this.secret();
    const identifierHash = hashIdentifier(identifier, secret);
    const existing = await this.mediaModel.findOne({ identifierHash }).exec();

    if (!existing) {
      return null;
    }

    Object.assign(existing, HISTORY_RESET);

    if (this.isUnused(existing)) {
      await this.mediaModel.deleteOne({ identifierHash }).exec();
    } else {
      await existing.save();
    }

    return this.toFlags(existing, secret)!;
  }

  // Clears the whole watch history: history-only rows are deleted, flagged rows keep their flags.
  public async clearAllWatchHistory(): Promise<void> {
    const unflagged = { isLiked: false, isFavorite: false, isDownloaded: false };

    await this.mediaModel.deleteMany(unflagged).exec();
    await this.mediaModel.updateMany({ watchedAt: { $ne: null } }, HISTORY_RESET).exec();
  }

  private isNewViewing(previous: Date | null | undefined, now: Date): boolean {
    return !previous || now.getTime() - new Date(previous).getTime() > WATCH_SESSION_GAP_MS;
  }

  // Creates the row if needed and flips the flag. Refreshes the stored card, and deletes the row once nothing is left on it.
  private async toggleFlag(identifier: string, flag: MediaFlag, media: IMediaSnapshot): Promise<MediaFlags> {
    const secret = this.secret();
    const identifierHash = hashIdentifier(identifier, secret);
    const existing = await this.mediaModel.findOne({ identifierHash }).exec();

    if (!existing) {
      const created = await this.create(identifier, media, secret, { [flag]: true, [FLAG_DATES[flag]]: new Date() });
      return this.toFlags(created, secret)!;
    }

    const isOn = !existing[flag];

    Object.assign(existing, this.encryptCatalog(identifier, media, secret), { [flag]: isOn, [FLAG_DATES[flag]]: isOn ? new Date() : null });

    if (this.isUnused(existing)) {
      await this.mediaModel.deleteOne({ identifierHash }).exec();
    } else {
      await existing.save();
    }

    return this.toFlags(existing, secret)!;
  }

  // True when no flag or watch progress is left, so the row no longer needs to exist.
  private isUnused(row: MediaDocument): boolean {
    return !row.isLiked && !row.isFavorite && !row.isDownloaded && row.watchPositionAt === null;
  }

  // Stores a new row with the encrypted card and the given starting values.
  private async create(identifier: string, media: IMediaSnapshot, secret: string, extras: Partial<MediaDocument>): Promise<MediaDocument> {
    return this.mediaModel.create({
      identifierHash: hashIdentifier(identifier, secret),
      ...this.encryptCatalog(identifier, media, secret),
      ...FLAG_DEFAULTS,
      ...extras,
    });
  }

  // Encrypts the card fields before they are stored.
  private encryptCatalog(identifier: string, media: IMediaSnapshot, secret: string) {
    const originURL = decryptShortTokenToURL(identifier);
    return {
      identifier: encryptText(identifier, secret),
      url: encryptText(originURL ?? `/media/${identifier}`, secret),
      title: encryptText(media.title, secret),
      description: encryptText('', secret),
      thumbnailSrc: encryptText(JSON.stringify(media.thumbnailSrc), secret),
      previewSrc: encryptText(media.previewSrc ?? '', secret),
      postedAt: encryptText(media.postedAt, secret),
      duration: media.duration,
      source: (originURL && this.centreRegistry.findByURL(originURL)?.source) || 'unknown',
    };
  }

  // Decrypts a stored row into the public media card shape with its flags.
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
      ...this.previewOf(tryDecryptText(row.previewSrc, secret)),
      source: this.centreRegistry.findByURL(decryptShortTokenToURL(identifier) ?? '')?.source,
      isLiked: row.isLiked,
      isFavorite: row.isFavorite,
      isDownloaded: row.isDownloaded ?? false,
      likedAt: row.likedAt ?? undefined,
      favoritedAt: row.favoritedAt ?? undefined,
      watchedAt: row.watchedAt ?? undefined,
      watchedTimes: row.watchedTimes ?? 0,
      watchPositionAt: row.watchPositionAt ?? undefined,
    };
  }

  // Returns the preview field only when one is stored, so cards without a preview keep their old shape.
  private previewOf(raw: string | undefined): Pick<IMediaInfo, 'previewSrc'> {
    return raw ? { previewSrc: raw } : {};
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
      isDownloaded: row.isDownloaded ?? false,
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
