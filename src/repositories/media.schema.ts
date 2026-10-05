import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

// One media the user cares about: liked, favorited, downloaded, or with watch progress. Deleted once none of those is left.
@Schema({ collection: 'medias', timestamps: true })
export class MediaDocument {
  @Prop({ required: true, unique: true, index: true })
  identifier: string;

  @Prop({ required: true })
  url: string;

  // Card text may be empty (no description, no posted date), and Mongoose treats '' as missing on required strings, so these are not required.
  @Prop({ default: '' })
  title: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ default: '' })
  thumbnailSrc: string;

  @Prop({ default: '' })
  previewSrc: string;

  @Prop({ default: '' })
  postedAt: string;

  @Prop({ required: true, default: 0 })
  duration: number;

  @Prop({ required: true, default: 'xmd' })
  source: string;

  @Prop({ required: true, default: false })
  isLiked: boolean;

  @Prop({ required: true, default: false })
  isFavorite: boolean;

  @Prop({ required: true, default: false })
  isDownloaded: boolean;

  @Prop({ type: Date, default: null })
  likedAt: Date | null;

  @Prop({ type: Date, default: null })
  favoritedAt: Date | null;

  @Prop({ type: Date, default: null })
  watchedAt: Date | null;

  @Prop({ type: Date, default: null })
  downloadedAt: Date | null;

  @Prop({ default: 0 })
  downloadSize: number;

  @Prop({ required: true, default: 0 })
  watchedTimes: number;

  @Prop({ type: Number, default: null })
  watchPositionAt: number | null;
}

export type MediaModel = HydratedDocument<MediaDocument>;

export const MediaSchema = SchemaFactory.createForClass(MediaDocument);

MediaSchema.index({ isLiked: 1, likedAt: -1, updatedAt: -1 });
MediaSchema.index({ isFavorite: 1, favoritedAt: -1, updatedAt: -1 });
