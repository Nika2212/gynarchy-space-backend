import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { IMediaSnapshot } from '../shared/interfaces/media-snapshot.interface';
import { DownloadDocument } from './download.schema';

@Injectable()
export class DownloadRepository {
  constructor(@InjectModel(DownloadDocument.name) private readonly downloadModel: Model<DownloadDocument>) {}

  // Every unfinished download, oldest first, so a restart queues them in the order they were started.
  public async findAll(): Promise<DownloadDocument[]> {
    return this.downloadModel.find().sort({ createdAt: 1 }).lean().exec();
  }

  public async savePending(identifier: string, media: IMediaSnapshot): Promise<void> {
    await this.downloadModel.updateOne({ identifier }, { $set: { media, state: 'pending', error: null } }, { upsert: true }).exec();
  }

  public async markFailed(identifier: string, error: string): Promise<void> {
    await this.downloadModel.updateOne({ identifier }, { $set: { state: 'failed', error } }).exec();
  }

  public async remove(identifier: string): Promise<void> {
    await this.downloadModel.deleteOne({ identifier }).exec();
  }
}
