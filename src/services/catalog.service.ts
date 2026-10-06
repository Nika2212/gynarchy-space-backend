import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CatalogRepository, ICatalogRow } from '../repositories/catalog.repository';
import { IMediaContainer } from '../shared/interfaces/media-container.interface';
import { IMediaInfo } from '../shared/interfaces/media-info.interface';
import { IFindAll } from '../shared/interfaces/query.interface';
import { PER_PAGE_SIZE } from '../shared/paging';
import { toSearchTerms } from '../shared/search-terms';
import { assertValidHTTPURL, encryptURLToShortToken } from '../shared/url-token';

const MAX_SEARCH_KEYWORD_LENGTH = 200;
const MIN_PAGE_NUMBER = 1;
const MAX_PAGE_NUMBER = 1000;
const ID_FACTOR = 1_000_000_000;
const DEFAULT_SCREENSHOTS = 5;

interface ICatalogSite {
  key: 'xmd' | 'hf' | 'fvc';
  number: number;
  envKey: 'XMD' | 'HF' | 'FVC';
  thumbnailSize: string;
  screenshots: 'sequence' | 'single';
  preview: boolean;
  rewriteThumbnail?: (path: string) => string;
  pagePath: (id: number, slug: string) => string;
}

const SITES: ICatalogSite[] = [
  {
    key: 'xmd',
    number: 1,
    envKey: 'XMD',
    thumbnailSize: '320x180',
    screenshots: 'sequence',
    preview: false,
    rewriteThumbnail: (path) => path.replace('videos_screenshots', 'videos_sources').replace('320x180', 'screenshots'),
    pagePath: (_id, slug) => `/videos/${encodeURIComponent(slug)}/`,
  },
  {
    key: 'hf',
    number: 2,
    envKey: 'HF',
    thumbnailSize: '800x450',
    screenshots: 'single',
    preview: true,
    pagePath: (_id, slug) => `/videos/${encodeURIComponent(slug)}/`,
  },
  {
    key: 'fvc',
    number: 3,
    envKey: 'FVC',
    thumbnailSize: '320x180',
    screenshots: 'sequence',
    preview: false,
    pagePath: (id, slug) => `/video/${id}/${encodeURIComponent(slug)}/`,
  },
];

@Injectable()
export class CatalogService {
  private readonly bases = new Map<ICatalogSite['key'], string>();

  constructor(
    private readonly catalogRepository: CatalogRepository,
    configService: ConfigService,
  ) {
    for (const site of SITES) {
      const base = (configService.get<string>(site.envKey) ?? '').trim();
      if (this.isHttp(base)) {
        this.bases.set(site.key, base);
      }
    }
  }

  // Searches the crawler catalog and returns one page of media cards.
  public async search(query: IFindAll): Promise<IMediaContainer> {
    const keyword = this.keyword(query.keyword);
    this.assertPage(query.page);
    const terms = toSearchTerms(keyword);
    const random = query.random === 'true' && keyword === '';
    const rows = random ? await this.catalogRepository.random(query.page) : keyword !== '' && terms.length === 0 ? [] : await this.catalogRepository.search(terms, query.page);

    return {
      medias: rows.flatMap((row) => {
        const media = this.toMedia(row);
        return media ? [media] : [];
      }),
      meta: {
        currentPage: query.page,
        isLastPage: rows.length < PER_PAGE_SIZE,
      },
    };
  }

  // Rejects non-strings and over-long keywords. A missing keyword browses the newest videos.
  private keyword(keyword: IFindAll['keyword']): string {
    if (keyword === undefined || keyword === null) {
      return '';
    }
    if (typeof keyword !== 'string') {
      throw new BadRequestException('Invalid keyword: must be a string');
    }
    if (keyword.length > MAX_SEARCH_KEYWORD_LENGTH) {
      throw new BadRequestException(`Invalid keyword: exceeds maximum length of ${MAX_SEARCH_KEYWORD_LENGTH}`);
    }
    return keyword.trim();
  }

  private assertPage(page: number): void {
    if (!Number.isInteger(page) || page < MIN_PAGE_NUMBER || page > MAX_PAGE_NUMBER) {
      throw new BadRequestException(`Invalid page: must be an integer between ${MIN_PAGE_NUMBER} and ${MAX_PAGE_NUMBER}`);
    }
  }

  // Rebuilds the page, screenshots, and preview the centres would have parsed from a search card.
  private toMedia(row: ICatalogRow): IMediaInfo | undefined {
    const documentId = toDocumentId(row._id);
    if (documentId === undefined) {
      return undefined;
    }

    const siteNumber = Math.floor(documentId / ID_FACTOR);
    const videoId = documentId - siteNumber * ID_FACTOR;
    const site = SITES.find((entry) => entry.number === siteNumber);
    const base = site ? this.bases.get(site.key) : undefined;
    const slug = typeof row.s === 'string' ? row.s.trim() : '';
    if (!site || !base || videoId <= 0 || slug === '') {
      return undefined;
    }

    const pageURL = this.absolute(base, site.pagePath(videoId, slug));
    const thumbnailSrc = pageURL ? this.thumbnails(site, base, videoId, row) : [];
    if (!pageURL || thumbnailSrc.length === 0) {
      return undefined;
    }

    const identifier = encryptURLToShortToken(pageURL);
    const preview = this.preview(site, base, videoId, row);

    return {
      title: typeof row.n === 'string' ? row.n.trim() : '',
      description: typeof row.x === 'string' ? row.x : '',
      postedAt: '',
      duration: typeof row.d === 'number' && Number.isFinite(row.d) ? row.d * 1000 : 0,
      thumbnailSrc,
      ...(preview ? { previewSrc: preview } : {}),
      source: site.key,
      identifier,
      url: `/media/${identifier}`,
    };
  }

  private thumbnails(site: ICatalogSite, base: string, videoId: number, row: ICatalogRow): string[] {
    if (typeof row.u === 'string' && row.u.startsWith('http')) {
      const cover = this.absolute(base, row.u);
      return cover ? [this.imagePath(cover)] : [];
    }

    const coverShot = Number.isInteger(row.t) && (row.t as number) > 0 ? (row.t as number) : 1;
    const count = site.screenshots === 'single' ? 1 : Number.isInteger(row.c) && (row.c as number) > 0 ? (row.c as number) : DEFAULT_SCREENSHOTS;
    const folder = Math.floor(videoId / 1000) * 1000;
    const shots: string[] = [];

    for (let shot = 1; shot <= count; shot += 1) {
      let path = `/contents/videos_screenshots/${folder}/${videoId}/${site.thumbnailSize}/${site.screenshots === 'single' ? coverShot : shot}.jpg`;
      if (site.rewriteThumbnail) {
        path = site.rewriteThumbnail(path);
      }
      const absolute = this.absolute(base, path);
      if (absolute) {
        shots.push(this.imagePath(absolute));
      }
    }

    return shots;
  }

  private preview(site: ICatalogSite, base: string, videoId: number, row: ICatalogRow): string | undefined {
    if (!site.preview || typeof row.p !== 'string') {
      return undefined;
    }

    const match = row.p.match(/^(\d+)\/([0-9a-f]+)$/i);
    if (!match) {
      return undefined;
    }

    const folder = Math.floor(videoId / 1000) * 1000;
    const absolute = this.absolute(base, `/get_file/${match[1]}/${match[2]}/${folder}/${videoId}/${videoId}_preview.mp4/`);
    return absolute ? `/previews/${encryptURLToShortToken(absolute)}` : undefined;
  }

  private imagePath(url: string): string {
    return `/images/${encryptURLToShortToken(url)}`;
  }

  private absolute(base: string, path: string): string | undefined {
    try {
      const url = new URL(path, base).href;
      assertValidHTTPURL(url);
      return url;
    } catch {
      return undefined;
    }
  }

  private isHttp(url: string): boolean {
    try {
      assertValidHTTPURL(url);
      return true;
    } catch {
      return false;
    }
  }
}

function toDocumentId(value: unknown): number | undefined {
  try {
    const id = typeof value === 'number' ? value : value && typeof (value as { toNumber?: unknown }).toNumber === 'function' ? (value as { toNumber: () => number }).toNumber() : Number.NaN;
    return Number.isSafeInteger(id) ? id : undefined;
  } catch {
    return undefined;
  }
}
