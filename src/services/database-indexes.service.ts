import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AlbumDocument } from '../repositories/album.schema';
import { DownloadDocument } from '../repositories/download.schema';
import { MediaDocument } from '../repositories/media.schema';

// Makes the indexes of the backend's own collections match their schemas on every start: missing ones are created, and ones
// the schema no longer has are dropped (e.g. the old unique identifierHash_1, which rejects every row now that the field is gone).
// Only medias, albums, and downloads are touched; the crawler's collections are left alone.
@Injectable()
export class DatabaseIndexesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseIndexesService.name);

  constructor(
    @InjectModel(MediaDocument.name) private readonly mediaModel: Model<MediaDocument>,
    @InjectModel(AlbumDocument.name) private readonly albumModel: Model<AlbumDocument>,
    @InjectModel(DownloadDocument.name) private readonly downloadModel: Model<DownloadDocument>,
  ) {}

  public async onApplicationBootstrap(): Promise<void> {
    for (const model of [this.mediaModel, this.albumModel, this.downloadModel] as Model<unknown>[]) {
      await this.sync(model);
    }
  }

  // A failure is logged, not thrown: the app still works with the indexes it has.
  private async sync(model: Model<unknown>): Promise<void> {
    const collection = model.collection.collectionName;
    try {
      const dropped = await model.syncIndexes();
      if (dropped.length > 0) {
        this.logger.warn(`Dropped outdated indexes on ${collection}: ${dropped.join(', ')}`);
      }
    } catch (error) {
      this.logger.error(`Could not sync indexes on ${collection}: ${(error as Error).message}`);
    }
  }
}
