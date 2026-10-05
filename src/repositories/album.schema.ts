import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

// One media saved in an album, with the card shown in the album.
@Schema({ _id: false })
export class AlbumItem {
  @Prop({ required: true })
  identifier: string;

  // Card text may be empty, and Mongoose treats '' as missing on required strings, so these are not required.
  @Prop({ default: '' })
  title: string;

  @Prop({ default: '' })
  thumbnailSrc: string;

  @Prop({ default: '' })
  previewSrc: string;

  @Prop({ default: '' })
  postedAt: string;

  @Prop({ required: true, default: 0 })
  duration: number;

  @Prop({ type: Date, required: true })
  addedAt: Date;
}

export const AlbumItemSchema = SchemaFactory.createForClass(AlbumItem);

// A user-made album: its name and the media saved in it.
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
