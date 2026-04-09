import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** Persists {@link IMediaInfo} / {@link IMedia} / {@link IEntity} */
export const medias = pgTable('medias', {
  id: uuid('id').primaryKey().defaultRandom(),

  identifier: text('identifier').notNull().unique(),
  url: text('url').notNull().unique(),
  thumbnailSrc: jsonb('thumbnail_src').$type<string[]>().notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  postedAt: text('posted_at').notNull(),
  duration: integer('duration').notNull(),

  isDownloaded: boolean('is_downloaded').notNull().default(false),
  isLiked: boolean('is_liked').notNull().default(false),
  isFavorite: boolean('is_favorite').notNull().default(false),
  watchedAt: timestamp('watched_at', { withTimezone: true, mode: 'date' }),
  watchedTimes: integer('watched_times').notNull().default(0),
  watchPositionAt: integer('watch_position_at'),
});

export type MediaRow = typeof medias.$inferSelect;
export type NewMediaRow = typeof medias.$inferInsert;
