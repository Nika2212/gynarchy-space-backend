import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Collection, Document, Filter } from 'mongodb';
import { Connection } from 'mongoose';
import { PER_PAGE_SIZE } from '../shared/paging';
import { maxEditsFor, minimumTermsFor } from '../shared/search-terms';

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

const SEARCH_INDEX = 'default';
const TITLE = 'n';
const PEOPLE_AND_TAGS = ['m', 'k'];
const CATEGORY_AND_SLUG = ['g', 's'];
const DESCRIPTION = 'x';
const PREFIX_PATHS = [TITLE, ...PEOPLE_AND_TAGS, ...CATEGORY_AND_SLUG];
const MIN_PREFIX_LENGTH = 2;
const SHUFFLE_WINDOW_MS = 15 * 60 * 1000;
const SHUFFLE_SIZE = PER_PAGE_SIZE * 40;

// One term matches when it hits a field exactly, with typos, or (for the last term) as a word start.
function termClause(term: string, isLast: boolean): Record<string, unknown> {
  const maxEdits = maxEditsFor(term);
  const fuzzy = maxEdits === 0 ? undefined : { maxEdits, prefixLength: 1, maxExpansions: 50 };
  const field = (path: string | string[], boost: number): Record<string, unknown> => ({
    text: { query: term, path, score: { boost: { value: boost } }, ...(fuzzy ? { fuzzy } : {}) },
  });

  const should: Record<string, unknown>[] = [field(TITLE, 10), field(PEOPLE_AND_TAGS, 6), field(CATEGORY_AND_SLUG, 3), field(DESCRIPTION, 1)];
  if (isLast && term.length >= MIN_PREFIX_LENGTH) {
    should.push({ wildcard: { query: `${term}*`, path: PREFIX_PATHS, allowAnalyzedField: true, score: { boost: { value: 2 } } } });
  }

  return { compound: { should, minimumShouldMatch: 1 } };
}

// A random page picks from the best SHUFFLE_SIZE matches, so it stays relevant and bounded.
function pageStages(skip: number, random: boolean): Document[] {
  return random ? [{ $limit: SHUFFLE_SIZE }, { $sample: { size: PER_PAGE_SIZE } }] : [{ $skip: skip }, { $limit: PER_PAGE_SIZE }];
}

// Atlas Search pipeline: every term is fuzzy-matched across fields, whole-phrase matches in the title rank first.
export function buildFuzzyPipeline(terms: string[], skip: number, random = false): Document[] {
  const clauses = terms.map((term, index) => termClause(term, index === terms.length - 1));

  return [
    {
      $search: {
        index: SEARCH_INDEX,
        compound: {
          must: [{ compound: { should: clauses, minimumShouldMatch: minimumTermsFor(terms.length) } }],
          should: terms.length > 1 ? [{ phrase: { query: terms, path: TITLE, slop: 3, score: { boost: { value: 20 } } } }] : [],
        },
      },
    },
    { $match: AVAILABLE },
    ...pageStages(skip, random),
    { $project: { ...CARD_FIELDS, score: { $meta: 'searchScore' } } },
  ];
}

@Injectable()
export class CatalogRepository implements OnModuleInit {
  private readonly logger = new Logger(CatalogRepository.name);
  private shuffle?: { window: number; ids: Promise<number[]> };

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

  // One page of catalog rows. No terms returns the newest videos; otherwise a typo-tolerant search, best match first or random.
  public async search(terms: string[], page: number, random = false): Promise<ICatalogRow[]> {
    const skip = (page - 1) * PER_PAGE_SIZE;

    if (terms.length === 0) {
      return this.videos().find(AVAILABLE, { projection: CARD_FIELDS }).sort({ _id: -1 }).skip(skip).limit(PER_PAGE_SIZE).toArray();
    }

    try {
      return await this.videos().aggregate<ICatalogRow>(buildFuzzyPipeline(terms, skip, random)).toArray();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Fuzzy search failed, using the text index instead: ${message}`);
      return random ? this.randomTextSearch(terms.join(' ')) : this.textSearch(terms.join(' '), skip);
    }
  }

  // One page of the current shuffle. The order stays the same until the next shuffle window.
  public async random(page: number): Promise<ICatalogRow[]> {
    const ids = (await this.shuffledIds()).slice((page - 1) * PER_PAGE_SIZE, page * PER_PAGE_SIZE);
    if (ids.length === 0) {
      return [];
    }

    const rows = await this.videos()
      .find({ _id: { $in: ids } }, { projection: CARD_FIELDS })
      .toArray();
    const byId = new Map(rows.map((row) => [String(row._id), row]));
    return ids.flatMap((id) => byId.get(String(id)) ?? []);
  }

  // Samples extra rows first so unavailable videos can be dropped without a full scan. $sample may repeat rows.
  private shuffledIds(): Promise<number[]> {
    const window = Math.floor(Date.now() / SHUFFLE_WINDOW_MS);
    if (this.shuffle?.window === window) {
      return this.shuffle.ids;
    }

    const ids = this.videos()
      .aggregate<{ _id: number }>([{ $sample: { size: SHUFFLE_SIZE * 2 } }, { $match: AVAILABLE }, { $project: { _id: 1 } }])
      .toArray()
      .then((rows) => [...new Map(rows.map((row) => [String(row._id), row._id])).values()].slice(0, SHUFFLE_SIZE));
    this.shuffle = { window, ids };
    ids.catch(() => {
      if (this.shuffle?.ids === ids) {
        this.shuffle = undefined;
      }
    });
    return ids;
  }

  private textSearch(keyword: string, skip: number): Promise<ICatalogRow[]> {
    const textSearch: Filter<ICatalogRow> = { $text: { $search: keyword }, ...AVAILABLE };
    return this.videos()
      .find(textSearch, { projection: { ...CARD_FIELDS, score: { $meta: 'textScore' } } })
      .sort({ score: { $meta: 'textScore' }, _id: -1 })
      .skip(skip)
      .limit(PER_PAGE_SIZE)
      .toArray();
  }

  private randomTextSearch(keyword: string): Promise<ICatalogRow[]> {
    return this.videos()
      .aggregate<ICatalogRow>([{ $match: { $text: { $search: keyword }, ...AVAILABLE } }, ...pageStages(0, true), { $project: CARD_FIELDS }])
      .toArray();
  }

  private videos(): Collection<ICatalogRow> {
    return this.connection.collection<ICatalogRow>(CATALOG_COLLECTION);
  }
}
