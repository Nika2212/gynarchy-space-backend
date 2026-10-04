import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { KtPlayerCentre } from './kt-player.centre';

@Injectable()
export class FVCCentre extends KtPlayerCentre {
  // Reads the FVC base URL from config and sets up the shared centre client.
  constructor(configService: ConfigService) {
    super(configService, 'FVC');
  }

  // FVC search URLs end with a slash: "/search/mistress/".
  protected searchPath(slug: string): string {
    return `${super.searchPath(slug)}/`;
  }

  // FVC expects empty category and sort filters alongside the shared search params.
  protected searchParams(slug: string, page: number): Record<string, unknown> {
    return {
      ...super.searchParams(slug, page),
      category_ids: '',
      sort_by: '',
    };
  }

  // FVC cards point at 320x180 screenshots 1-5, the same set the media page lists.
  protected pickThumbnail(attributes: Record<string, string>): string | undefined {
    return attributes['data-original'] || attributes['data-webp'] || undefined;
  }
}
