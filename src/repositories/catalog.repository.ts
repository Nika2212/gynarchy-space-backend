import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Collection, Filter } from 'mongodb';
import { Connection } from 'mongoose';
import { PER_PAGE_SIZE } from '../shared/paging';

export const CATALOG_COLLECTION = 'catalog';

// _id = site number * 1e9 + video id. Sites are 1, 2, and 3.
const ID_FACTOR = 1_000_000_000;
const ID_MIN = ID_FACTOR;
const ID_MAX = 4 * ID_FACTOR;

export interface ICatalogRow {
  _id: number;
  s?: string;
  n?: string;
  d?: number;
  t?: number;
  u?: string;
  c?: number;
  p?: string;
  x?: string;
  o?: true;
}

const CARD_FIELDS = { s: 1, n: 1, d: 1, t: 1, u: 1, c: 1, p: 1, x: 1 };

// Videos whose page is gone are stored with o: true and are not searchable.
const AVAILABLE: Filter<ICatalogRow> = {
  o: { $exists: false },
  s: { $type: 'string', $ne: '' },
  _id: { $gte: ID_MIN, $lt: ID_MAX },
};

@Injectable()
export class CatalogRepository implements OnModuleInit {
  private readonly logger = new Logger(CatalogRepository.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  // Builds the text index the keyword search reads. A failure is logged; the app still starts.
  public async onModuleInit(): Promise<void> {
    try {
      await this.videos().createIndex(
        { n: 'text', m: 'text', k: 'text', g: 'text', s: 'text', x: 'text' },
        {
          name: 'catalog_text',
          default_language: 'none',
          weights: { n: 10, m: 8, k: 6, g: 5, s: 3, x: 1 },
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`Could not ensure the catalog search index: ${message}`);
    }
  }

  // One page of catalog rows. An empty keyword returns the newest videos; otherwise a text search, best match first.
  public async search(keyword: string, page: number): Promise<ICatalogRow[]> {
    const skip = (page - 1) * PER_PAGE_SIZE;
    const videos = this.videos();

    if (keyword === '') {
      return videos.find(AVAILABLE, { projection: CARD_FIELDS }).sort({ _id: -1 }).skip(skip).limit(PER_PAGE_SIZE).toArray();
    }

    const textSearch: Filter<ICatalogRow> = { $text: { $search: keyword }, ...AVAILABLE };
    return videos
      .find(textSearch, { projection: { ...CARD_FIELDS, score: { $meta: 'textScore' } } })
      .sort({ score: { $meta: 'textScore' }, _id: -1 })
      .skip(skip)
      .limit(PER_PAGE_SIZE)
      .toArray();
  }

  private videos(): Collection<ICatalogRow> {
    return this.connection.collection<ICatalogRow>(CATALOG_COLLECTION);
  }
}
