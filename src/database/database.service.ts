import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE } from './database.tokens';
import * as schema from './media-schema';
import { medias, type MediaRow, type NewMediaRow } from './media-schema';
import type { IMediaInfo } from '../interfaces/media-info.interface';
import { encryptUrlToShortToken } from '../core/helpers/utils';

export type DrizzleSchema = typeof schema;
export type AppDatabase = NodePgDatabase<DrizzleSchema>;

@Injectable()
export class DatabaseService implements OnModuleInit {
  constructor(
    @Inject(DRIZZLE) private readonly db: AppDatabase,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    // await this.wipeAllMedias();
  }

  async wipeAllMedias(): Promise<void> {
    await this.db.delete(medias);
  }

  rowsToMedias(rows: NewMediaRow[]): IMediaInfo[] {
    return rows.map(r => r as IMediaInfo);
  }

  mediasToRows(medias: readonly IMediaInfo[]): NewMediaRow[] {
    return medias.map((m) => this.mediaToRow(m));
  }

  mediaToRow(media: IMediaInfo): NewMediaRow {
    const identifier = media.identifier ?? encryptUrlToShortToken(media.url);

    return {
      identifier,
      url: media.url,
      thumbnailSrc: media.thumbnailSrc,
      title: media.title,
      description: media.description ?? '',
      postedAt: media.postedAt,
      duration: media.duration,
      isDownloaded: media.isDownloaded ?? false,
      isLiked: media.isLiked ?? false,
      isFavorite: media.isFavorite ?? false,
      watchedAt: media.watchedAt,
      watchedTimes: media.watchedTimes ?? 0,
      watchPositionAt: media.watchPositionAt,
    };
  }

  async insertMedia(values: NewMediaRow): Promise<MediaRow> {
    const [row] = await this.db.insert(medias).values(values).returning();
    return row;
  }

  async insertMedias(values: readonly NewMediaRow[]): Promise<MediaRow[]> {
    if (values.length === 0) {
      return [];
    }
    return this.db.insert(medias).values([...values]).returning();
  }

  /**
   * Bulk insert only new medias (by unique `url`) and ignore duplicates.
   * Single SQL request: `INSERT ... ON CONFLICT (url) DO NOTHING`.
   */
  async insertNewMedias(values: readonly NewMediaRow[]): Promise<MediaRow[]> {
    if (values.length === 0) {
      return [];
    }
    return this.db
      .insert(medias)
      .values([...values])
      .onConflictDoNothing({ target: medias.url })
      .returning();
  }

  /**
   * Bulk upsert medias (by unique `url`): insert new rows, update existing rows.
   * Single SQL request: `INSERT ... ON CONFLICT (url) DO UPDATE SET ...`.
   */
  async upsertMedias(values: readonly NewMediaRow[]): Promise<MediaRow[]> {
    if (values.length === 0) {
      return [];
    }

    return this.db
      .insert(medias)
      .values([...values])
      .onConflictDoUpdate({
        target: medias.identifier,
        set: {
          url: sql`excluded.url`,
          thumbnailSrc: sql`excluded.thumbnail_src`,
          title: sql`excluded.title`,
          description: sql`excluded.description`,
          postedAt: sql`excluded.posted_at`,
          duration: sql`excluded.duration`,
          isDownloaded: sql`excluded.is_downloaded`,
          isLiked: sql`excluded.is_liked`,
          isFavorite: sql`excluded.is_favorite`,
          watchedAt: sql`excluded.watched_at`,
          watchedTimes: sql`excluded.watched_times`,
          watchPositionAt: sql`excluded.watch_position_at`,
        },
      })
      .returning();
  }

  async findMediaById(id: string): Promise<MediaRow | undefined> {
    const [row] = await this.db.select().from(medias).where(eq(medias.id, id)).limit(1);
    return row;
  }

  async findMedias(options: { limit?: number; offset?: number } = {}): Promise<MediaRow[]> {
    const { limit = 100, offset = 0 } = options;
    return this.db.select().from(medias).orderBy(desc(medias.id)).limit(limit).offset(offset);
  }

  async countMedias(): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(medias);
    return Number(row?.n ?? 0);
  }

  async updateMedia(
    id: string,
    patch: Omit<Partial<NewMediaRow>, 'id'>,
  ): Promise<MediaRow | undefined> {
    const [row] = await this.db
      .update(medias)
      .set(patch)
      .where(eq(medias.id, id))
      .returning();
    return row;
  }

  async deleteMedia(id: string): Promise<boolean> {
    const [row] = await this.db.delete(medias).where(eq(medias.id, id)).returning({ id: medias.id });
    return row !== undefined;
  }

  async findMediaByIdentifier(identifier: string): Promise<MediaRow | undefined> {
    const [row] = await this.db
      .select()
      .from(medias)
      .where(eq(medias.identifier, identifier))
      .limit(1);
    return row;
  }
}
