import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CentreRegistry } from '../core/centres/centre.registry';
import { decryptShortTokenToURL } from '../shared/url-token';
import type { IMediaInfo } from '../shared/interfaces/media-info.interface';
import type { IMediaSnapshot } from '../shared/interfaces/media-snapshot.interface';
import { MediaDocument } from './media.schema';

export type MediaFlags = Pick<MediaDocument, 'identifier' | 'isLiked' | 'isFavorite' | 'isDownloaded' | 'watchedAt' | 'watchedTimes' | 'watchPositionAt'>;

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
    private readonly centreRegistry: CentreRegistry,
  ) {}

  // Loads every stored media with its flags, most recently changed first.
  public async findLibrary(): Promise<IMediaInfo[]> {
    const rows = await this.mediaModel.find(LIBRARY_FILTER).sort({ updatedAt: -1 }).exec();

    return rows.map((row) => this.toMediaInfo(row)).filter((media): media is IMediaInfo => media !== undefined);
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
    const existing = await this.mediaModel.findOne({ identifier }).exec();
    const watchedAt = new Date();

    if (!existing) {
      const created = await this.create(identifier, media, { watchPositionAt, watchedAt, watchedTimes: 1 });
      return this.toFlags(created)!;
    }

    const watchedTimes = (existing.watchedTimes ?? 0) + (this.isNewViewing(existing.watchedAt, watchedAt) ? 1 : 0);

    Object.assign(existing, this.cardFields(identifier, media), { watchPositionAt, watchedAt, watchedTimes });
    await existing.save();
    return this.toFlags(existing)!;
  }

  // Removes one media from the watch history. The row stays while it is liked, favorited, or downloaded. Null when it was not stored.
  public async clearWatchHistory(identifier: string): Promise<MediaFlags | null> {
    const existing = await this.mediaModel.findOne({ identifier }).exec();

    if (!existing) {
      return null;
    }

    Object.assign(existing, HISTORY_RESET);
    await this.saveOrDelete(existing);
    return this.toFlags(existing)!;
  }

  // Marks one media as stored in the bucket, creating the row with its card when needed.
  public async markDownloaded(identifier: string, media: IMediaSnapshot, downloadSize: number): Promise<MediaFlags> {
    const existing = await this.mediaModel.findOne({ identifier }).exec();
    const download = { isDownloaded: true, downloadedAt: new Date(), downloadSize };

    if (!existing) {
      const created = await this.create(identifier, media, download);
      return this.toFlags(created)!;
    }

    Object.assign(existing, this.cardFields(identifier, media), download);
    await existing.save();
    return this.toFlags(existing)!;
  }

  // Clears the downloaded flag and deletes the row once nothing else is on it. Null when it was not stored.
  public async clearDownloaded(identifier: string): Promise<MediaFlags | null> {
    const existing = await this.mediaModel.findOne({ identifier }).exec();

    if (!existing) {
      return null;
    }

    Object.assign(existing, { isDownloaded: false, downloadedAt: null, downloadSize: 0 });
    await this.saveOrDelete(existing);
    return this.toFlags(existing)!;
  }

  // Size in bytes of the stored copy, or null when the media is not downloaded.
  public async findDownloadSize(identifier: string): Promise<number | null> {
    const row = await this.mediaModel.findOne({ identifier, isDownloaded: true }).exec();
    return row ? (row.downloadSize ?? 0) : null;
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
    const existing = await this.mediaModel.findOne({ identifier }).exec();

    if (!existing) {
      const created = await this.create(identifier, media, { [flag]: true, [FLAG_DATES[flag]]: new Date() });
      return this.toFlags(created)!;
    }

    const isOn = !existing[flag];

    Object.assign(existing, this.cardFields(identifier, media), { [flag]: isOn, [FLAG_DATES[flag]]: isOn ? new Date() : null });
    await this.saveOrDelete(existing);
    return this.toFlags(existing)!;
  }

  // Deletes the row once no flag or watch progress is left on it, otherwise saves it.
  private async saveOrDelete(row: MediaDocument & { save(): Promise<unknown> }): Promise<void> {
    if (this.isUnused(row)) {
      await this.mediaModel.deleteOne({ identifier: row.identifier }).exec();
    } else {
      await row.save();
    }
  }

  // True when no flag or watch progress is left, so the row no longer needs to exist.
  private isUnused(row: MediaDocument): boolean {
    return !row.isLiked && !row.isFavorite && !row.isDownloaded && row.watchPositionAt === null;
  }

  // Stores a new row with the card and the given starting values.
  private async create(identifier: string, media: IMediaSnapshot, extras: Partial<MediaDocument>): Promise<MediaDocument> {
    return this.mediaModel.create({
      ...this.cardFields(identifier, media),
      ...FLAG_DEFAULTS,
      ...extras,
    });
  }

  // The card fields stored with every row, refreshed on each write.
  private cardFields(identifier: string, media: IMediaSnapshot) {
    const originURL = decryptShortTokenToURL(identifier);
    return {
      identifier,
      url: originURL ?? `/media/${identifier}`,
      title: media.title,
      description: '',
      thumbnailSrc: JSON.stringify(media.thumbnailSrc),
      previewSrc: media.previewSrc ?? '',
      postedAt: media.postedAt,
      duration: media.duration,
      source: (originURL && this.centreRegistry.findByURL(originURL)?.source) || 'unknown',
    };
  }

  // Maps a stored row to the public media card shape with its flags.
  private toMediaInfo(row: MediaDocument): IMediaInfo | undefined {
    if (!row.identifier) {
      return undefined;
    }

    return {
      identifier: row.identifier,
      url: `/media/${row.identifier}`,
      title: row.title ?? '',
      description: row.description ?? '',
      postedAt: row.postedAt ?? '',
      duration: row.duration ?? 0,
      thumbnailSrc: this.parseThumbnailSrc(row.thumbnailSrc),
      ...this.previewOf(row.previewSrc),
      source: this.centreRegistry.findByURL(decryptShortTokenToURL(row.identifier) ?? '')?.source,
      isLiked: row.isLiked,
      isFavorite: row.isFavorite,
      isDownloaded: row.isDownloaded ?? false,
      likedAt: row.likedAt ?? undefined,
      favoritedAt: row.favoritedAt ?? undefined,
      watchedAt: row.watchedAt ?? undefined,
      watchedTimes: row.watchedTimes ?? 0,
      watchPositionAt: row.watchPositionAt ?? undefined,
      downloadedAt: row.downloadedAt ?? undefined,
      downloadSize: row.downloadSize || undefined,
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

  // Maps the row to public flag fields.
  private toFlags(row: MediaDocument): MediaFlags | undefined {
    if (!row.identifier) {
      return undefined;
    }

    return {
      identifier: row.identifier,
      isLiked: row.isLiked,
      isFavorite: row.isFavorite,
      isDownloaded: row.isDownloaded ?? false,
      watchedAt: row.watchedAt ?? null,
      watchedTimes: row.watchedTimes ?? 0,
      watchPositionAt: row.watchPositionAt ?? null,
    };
  }
}
