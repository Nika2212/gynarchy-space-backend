// XMD catalog crawler: a standalone Railway Function (Bun) that copies XMD's video listing into MongoDB for local search.
// It is not part of the Nest app. Each run crawls up to MAX_PAGES pages and exits, so it can run on a cron schedule.
//
// Env:
//   XMD           XMD base URL, e.g. https://www.xmegadrive.com (required)
//   MONGODB_URI   Atlas connection string (required unless DRY_RUN=1)
//   MONGODB_DB    database name, default "gynarchy"
//   MODE          "backfill" walks every page and remembers where it stopped; "update" reads from page 1 until it meets known videos
//   MAX_PAGES     pages per run, default 10
//   START_PAGE    backfill only: start here instead of the saved position
//   DELAY_MS      pause between pages, default 2500 (plus up to 30% random jitter)
//   DRY_RUN       "1" parses and prints without touching the database

import * as cheerio from 'cheerio';
import { MongoClient, type AnyBulkWriteOperation, type Collection } from 'mongodb';

const SOURCE = 'xmd';
const BLOCK_ID = 'list_videos_latest_videos_list';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_PAGE_ATTEMPTS = 4;
const RETRY_BASE_MS = 5_000;
// 403/429 usually mean "slow down"; wait much longer before the next try.
const BLOCKED_PAUSE_MS = 60_000;
const MAX_CONSECUTIVE_FAILED_PAGES = 3;

interface ICatalogItem {
  _id: string;
  source: string;
  videoId: number;
  url: string;
  title: string;
  duration: number;
  thumbnail: string;
  screenshots: number;
  isHD: boolean;
  rating: number | null;
  views: number | null;
  postedText: string;
  postedAt: Date | null;
}

interface IListingPage {
  items: ICatalogItem[];
  lastPage: number | null;
}

interface ICrawlState {
  _id: string;
  nextPage: number;
  lastPage: number | null;
  backfillDone: boolean;
  updatedAt: Date;
}

interface IRunSummary {
  mode: string;
  pages: number;
  items: number;
  inserted: number;
  updated: number;
  nextPage: number | null;
  lastPage: number | null;
  seconds: number;
}

class PageError extends Error {
  readonly blocked: boolean;

  constructor(message: string, blocked = false) {
    super(message);
    this.blocked = blocked;
  }
}

function env(key: string, fallback = ''): string {
  return (process.env[key] ?? fallback).trim();
}

function envInt(key: string, fallback: number): number {
  const value = Number(env(key));
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms: number): number {
  return Math.round(ms * (1 + Math.random() * 0.3));
}

function log(message: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), message, ...data }));
}

function listingURL(base: string, page: number): string {
  const url = new URL('/latest-updates/', base);
  url.search = new URLSearchParams({ mode: 'async', function: 'get_block', block_id: BLOCK_ID, sort_by: 'post_date', from: String(page) }).toString();
  return url.href;
}

function toMS(clock: string): number {
  return clock
    .split(':')
    .map((part) => Number.parseInt(part, 10))
    .reduce((total, part) => (Number.isNaN(part) ? total : total * 60 + part), 0) * 1000;
}

// "72", "1.2K", "3M" -> 72, 1200, 3000000.
function toCount(text: string): number | null {
  const match = text.trim().match(/^([\d.]+)\s*([KkMm]?)$/);
  if (!match) {
    return null;
  }
  const multiplier = match[2].toLowerCase() === 'k' ? 1_000 : match[2].toLowerCase() === 'm' ? 1_000_000 : 1;
  return Math.round(Number(match[1]) * multiplier);
}

// "1 hour ago", "3 weeks ago", "2 years ago" -> an approximate date relative to the crawl time.
function toPostedAt(text: string, now: Date): Date | null {
  const match = text.trim().match(/^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i);
  if (!match) {
    return null;
  }
  const unitMS: Record<string, number> = {
    second: 1_000,
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 7 * 86_400_000,
    month: 30 * 86_400_000,
    year: 365 * 86_400_000,
  };
  return new Date(now.getTime() - Number(match[1]) * unitMS[match[2].toLowerCase()]);
}

function absolute(base: string, href: string | undefined): string | null {
  if (!href) {
    return null;
  }
  try {
    const url = new URL(href, base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function parseListing(base: string, html: string, now: Date): IListingPage {
  const $ = cheerio.load(html);
  const items: ICatalogItem[] = [];

  $(`#${BLOCK_ID}_items .item`).each((_, element) => {
    const node = $(element);
    const link = node.find('a').first();
    const image = node.find('img.thumb').first();
    const url = absolute(base, link.attr('href'));
    const thumbnail = absolute(base, image.attr('data-original'));
    const videoId = Number(node.find('[data-fav-video-id]').first().attr('data-fav-video-id') ?? thumbnail?.match(/\/(\d+)\/\d+x\d+\//)?.[1]);

    if (!url || !thumbnail || !Number.isInteger(videoId) || videoId <= 0) {
      return;
    }

    const postedText = node.find('.added').text().trim();
    const rating = Number.parseInt(node.find('.rating').text().trim(), 10);

    items.push({
      _id: `${SOURCE}:${videoId}`,
      source: SOURCE,
      videoId,
      url,
      title: (link.attr('title') ?? node.find('strong.title').text()).trim(),
      duration: toMS(node.find('.duration').text().trim()),
      thumbnail,
      screenshots: Number(image.attr('data-cnt')) || 5,
      isHD: node.find('.is-hd').length > 0,
      rating: Number.isNaN(rating) ? null : rating,
      views: toCount(node.find('.views').text()),
      postedText,
      postedAt: toPostedAt(postedText, now),
    });
  });

  const pages = $(`#${BLOCK_ID}_pagination [data-parameters]`)
    .map((_, element) => Number($(element).attr('data-parameters')?.match(/from:(\d+)/)?.[1]))
    .get()
    .filter((page: number) => Number.isInteger(page));

  return { items, lastPage: pages.length > 0 ? Math.max(...pages) : null };
}

// Fetches one listing page, retrying network errors and 5xx with backoff and pausing longer on 403/429.
async function fetchListing(base: string, page: number): Promise<IListingPage> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_PAGE_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(listingURL(base, page), {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.status === 403 || response.status === 429) {
        throw new PageError(`XMD answered ${response.status}`, true);
      }
      if (!response.ok) {
        throw new PageError(`XMD answered ${response.status}`);
      }

      const result = parseListing(base, await response.text(), new Date());
      if (result.items.length === 0 && result.lastPage === null) {
        throw new PageError('Page had no videos and no pagination');
      }
      return result;
    } catch (error) {
      lastError = error;
      const blocked = error instanceof PageError && error.blocked;
      log('page attempt failed', { page, attempt, error: (error as Error).message });

      if (attempt < MAX_PAGE_ATTEMPTS) {
        await sleep(blocked ? BLOCKED_PAUSE_MS : RETRY_BASE_MS * 2 ** (attempt - 1));
      }
    }
  }

  throw lastError;
}

// Inserts new videos and refreshes the changing fields of known ones. First-seen and the approximate post date are kept from the first sighting.
async function save(catalog: Collection<ICatalogItem & { firstSeenAt?: Date; lastSeenAt?: Date }>, items: ICatalogItem[]): Promise<{ inserted: number; updated: number }> {
  if (items.length === 0) {
    return { inserted: 0, updated: 0 };
  }

  const now = new Date();
  const operations: AnyBulkWriteOperation<ICatalogItem & { firstSeenAt?: Date; lastSeenAt?: Date }>[] = items.map(({ _id, postedAt, ...fields }) => ({
    updateOne: {
      filter: { _id },
      update: {
        $set: { ...fields, lastSeenAt: now },
        $setOnInsert: { postedAt, firstSeenAt: now },
      },
      upsert: true,
    },
  }));

  const result = await catalog.bulkWrite(operations, { ordered: false });
  return { inserted: result.upsertedCount, updated: result.matchedCount };
}

async function main(): Promise<void> {
  const started = Date.now();
  const base = env('XMD');
  const mode = env('MODE', 'backfill') === 'update' ? 'update' : 'backfill';
  const maxPages = envInt('MAX_PAGES', 10);
  const delayMS = envInt('DELAY_MS', 2500);
  const dryRun = env('DRY_RUN') === '1';

  if (!base) {
    throw new Error('XMD is required');
  }
  if (!dryRun && !env('MONGODB_URI')) {
    throw new Error('MONGODB_URI is required (or set DRY_RUN=1)');
  }

  const client = dryRun ? null : new MongoClient(env('MONGODB_URI'), { serverSelectionTimeoutMS: 10_000 });
  const db = client ? (await client.connect()).db(env('MONGODB_DB', 'gynarchy')) : null;
  const catalog = db?.collection<ICatalogItem & { firstSeenAt?: Date; lastSeenAt?: Date }>('catalog') ?? null;
  const states = db?.collection<ICrawlState>('catalog_state') ?? null;

  await catalog?.createIndex({ source: 1, postedAt: -1 });

  const state = (await states?.findOne({ _id: SOURCE })) ?? null;
  let page = mode === 'update' ? 1 : envInt('START_PAGE', state?.nextPage ?? 1);
  let lastPage = state?.lastPage ?? null;
  const summary: IRunSummary = { mode, pages: 0, items: 0, inserted: 0, updated: 0, nextPage: null, lastPage, seconds: 0 };
  let failedInARow = 0;

  log('run started', { mode, startPage: page, maxPages, dryRun, savedState: state });

  try {
    while (summary.pages < maxPages && (lastPage === null || page <= lastPage)) {
      let listing: IListingPage;

      try {
        listing = await fetchListing(base, page);
        failedInARow = 0;
      } catch (error) {
        failedInARow += 1;
        log('page skipped', { page, error: (error as Error).message, failedInARow });
        if (failedInARow >= MAX_CONSECUTIVE_FAILED_PAGES) {
          log('too many failed pages in a row, stopping this run', { page });
          break;
        }
        page += 1;
        continue;
      }

      lastPage = listing.lastPage ?? lastPage;
      const saved = catalog ? await save(catalog, listing.items) : { inserted: listing.items.length, updated: 0 };

      summary.pages += 1;
      summary.items += listing.items.length;
      summary.inserted += saved.inserted;
      summary.updated += saved.updated;
      log('page saved', { page, items: listing.items.length, ...saved, lastPage });

      if (dryRun && summary.pages === 1) {
        log('sample items', { items: listing.items.slice(0, 3) });
      }

      page += 1;

      if (mode === 'backfill') {
        await states?.updateOne(
          { _id: SOURCE },
          { $set: { nextPage: page, lastPage, backfillDone: lastPage !== null && page > lastPage, updatedAt: new Date() } },
          { upsert: true },
        );
      }

      if (mode === 'update' && listing.items.length > 0 && saved.inserted === 0) {
        log('reached known videos, update finished', { page: page - 1 });
        break;
      }

      if (summary.pages < maxPages) {
        await sleep(jitter(delayMS));
      }
    }
  } finally {
    summary.nextPage = mode === 'backfill' ? page : null;
    summary.lastPage = lastPage;
    summary.seconds = Math.round((Date.now() - started) / 1000);
    log('run finished', { ...summary });
    await client?.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    log('run failed', { error: (error as Error)?.message ?? String(error) });
    process.exit(1);
  });
