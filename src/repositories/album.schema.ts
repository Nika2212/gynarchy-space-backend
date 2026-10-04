import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

// One media saved in an album. Card fields are encrypted like media rows.
@Schema({ _id: false })
export class AlbumItem {
  @Prop({ required: true })
  identifierHash: string;

  @Prop({ required: true })
  identifier: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true, default: '' })
  thumbnailSrc: string;

  @Prop({ default: '' })
  previewSrc: string;

  @Prop({ required: true, default: '' })
  postedAt: string;

  @Prop({ required: true, default: 0 })
  duration: number;

  @Prop({ type: Date, required: true })
  addedAt: Date;
}

export const AlbumItemSchema = SchemaFactory.createForClass(AlbumItem);

// A user-made album: an encrypted name and the media saved in it.
@Schema({ collection: 'albums', timestamps: true })
export class AlbumDocument {
  @Prop({ required: true })
  name: string;

  @Prop({ type: [AlbumItemSchema], default: [] })
  items: AlbumItem[];

  createdAt?: Date;
}

export type AlbumModel = HydratedDocument<AlbumDocument>;

export const AlbumSchema = SchemaFactory.createForClass(AlbumDocument);
