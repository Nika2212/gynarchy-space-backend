import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { IMediaSnapshot } from '../shared/interfaces/media-snapshot.interface';

export type StoredDownloadState = 'pending' | 'failed';

// One download that has not finished yet, so it survives a restart: pending ones start again, failed ones stay listed for a retry.
// The row is deleted once the download completes or the user cancels it.
@Schema({ collection: 'downloads', timestamps: true })
export class DownloadDocument {
  @Prop({ required: true, unique: true, index: true })
  identifier: string;

  @Prop({ type: Object, required: true })
  media: IMediaSnapshot;

  @Prop({ type: String, required: true, default: 'pending' })
  state: StoredDownloadState;

  @Prop({ type: String, default: null })
  error: string | null;

  createdAt?: Date;
}

export type DownloadModel = HydratedDocument<DownloadDocument>;

export const DownloadSchema = SchemaFactory.createForClass(DownloadDocument);
