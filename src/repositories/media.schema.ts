import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ collection: 'medias', timestamps: true })
export class MediaDocument {
  @Prop({ required: true, unique: true, index: true })
  identifierHash: string;

  @Prop({ required: true })
  identifier: string;

  @Prop({ required: true })
  url: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true, default: '' })
  description: string;

  @Prop({ required: true, default: '' })
  thumbnailSrc: string;

  @Prop({ required: true, default: '' })
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
  isHidden: boolean;

  @Prop({ type: Date, default: null })
  watchedAt: Date | null;

  @Prop({ required: true, default: 0 })
  watchedTimes: number;

  @Prop({ type: Number, default: null })
  watchPositionAt: number | null;

  @Prop({ type: Date, default: null })
  lastSeenAt: Date | null;
}

export type MediaModel = HydratedDocument<MediaDocument>;

export const MediaSchema = SchemaFactory.createForClass(MediaDocument);
