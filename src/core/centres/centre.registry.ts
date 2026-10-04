import { GatewayTimeoutException, Inject, Injectable, Logger } from '@nestjs/common';

import { ICentreSearch } from '../../shared/interfaces/centre-search.interface';
import { IMediaInfo } from '../../shared/interfaces/media-info.interface';
import { PER_PAGE_SIZE } from '../../shared/paging';
import { BaseCentre } from './base.centre';

export const CENTRES = Symbol('CENTRES');

const SEARCH_DEADLINE_MS: number = 5000;

@Injectable()
export class CentreRegistry {
  private readonly logger = new Logger(CentreRegistry.name);

  // Holds every registered centre; app.module lists them under the CENTRES token.
  constructor(@Inject(CENTRES) private readonly centres: BaseCentre[]) {}

  // Searches every centre in parallel and interleaves the cards. A centre slower than the deadline is skipped; fails only when every centre fails.
  public async search(keyword: string, page: number): Promise<ICentreSearch> {
    const settled = await Promise.allSettled(this.centres.map((centre) => this.withDeadline(centre, centre.search(keyword, page))));
    const pages: IMediaInfo[][] = [];
    let firstError: unknown;

    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        pages.push(result.value);
        return;
      }
      firstError ??= result.reason;
      this.logger.warn(`${this.centres[index].source} search skipped: ${(result.reason as Error)?.message ?? 'unknown error'}`);
    });

    if (pages.length === 0 && firstError !== undefined) {
      throw firstError;
    }

    return {
      medias: this.interleave(pages),
      isLastPage: firstError === undefined && pages.every((medias) => medias.length < PER_PAGE_SIZE),
    };
  }

  // Returns the centre whose site the URL belongs to, if any.
  public findByURL(url: string): BaseCentre | undefined {
    return this.centres.find((centre) => centre.isAllowedAssetURL(url));
  }

  // True when the URL belongs to any registered centre.
  public isAllowedAssetURL(url: string): boolean {
    return this.findByURL(url) !== undefined;
  }

  // Rejects with 504 when the centre has not answered within the search deadline; the late answer is ignored.
  private withDeadline<T>(centre: BaseCentre, work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new GatewayTimeoutException(`${centre.source} search timed out after ${SEARCH_DEADLINE_MS} ms`)),
        SEARCH_DEADLINE_MS,
      );
    });

    return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
  }

  // Merges pages round-robin so each source shows up near the top, dropping repeated identifiers.
  private interleave(pages: IMediaInfo[][]): IMediaInfo[] {
    const merged: IMediaInfo[] = [];
    const seen = new Set<string>();
    const longest = Math.max(0, ...pages.map((medias) => medias.length));

    for (let i = 0; i < longest; i += 1) {
      for (const medias of pages) {
        const media = medias[i];
        if (!media || (media.identifier && seen.has(media.identifier))) {
          continue;
        }
        if (media.identifier) {
          seen.add(media.identifier);
        }
        merged.push(media);
      }
    }

    return merged;
  }
}
