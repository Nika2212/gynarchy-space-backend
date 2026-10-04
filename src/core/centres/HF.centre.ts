import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BaseCentre, MediaExtractionException } from './base.centre';

// KVS hides protected sources as "function/0/..."; those need kt_player and are not supported here.
const OBFUSCATED_VIDEO_URL_PREFIX: string = 'function/';

@Injectable()
export class HFCentre extends BaseCentre {
  // Reads the HF base URL from config and sets up the shared centre client.
  constructor(configService: ConfigService) {
    super(configService, 'HF');
  }

  // HF search URLs end with a slash: "/search/gynarchy/".
  protected searchPath(slug: string): string {
    return `${super.searchPath(slug)}/`;
  }

  // HF expects empty category and sort filters alongside the shared search params.
  protected searchParams(slug: string, page: number): Record<string, unknown> {
    return {
      ...super.searchParams(slug, page),
      category_ids: '',
      sort_by: '',
    };
  }

  // HF leaves data-original empty and serves the 800x450 screenshot in data-webp.
  protected pickThumbnail(attributes: Record<string, string>): string | undefined {
    return attributes['data-webp'] || attributes['data-original'] || undefined;
  }

  // HF cards carry a short muted mp4 teaser in data-preview.
  protected pickPreview(attributes: Record<string, string>): string | undefined {
    return attributes['data-preview'] || undefined;
  }

  // HF cards have a single thumbnail; the preview video stands in for the screenshot carousel.
  protected expandScreenshots(url: string): string[] {
    return [url];
  }

  // Reads the plain video URL from page flashvars, preferring the higher-quality alt source.
  protected async extractMediaURL(html: string): Promise<string> {
    const flashvars = this.extractFlashVars(html);

    for (const candidate of [flashvars.video_alt_url, flashvars.video_url]) {
      const videoURL = this.toVideoURL(candidate);
      if (videoURL) {
        return videoURL;
      }
    }

    throw new MediaExtractionException('video URL not resolved');
  }

  // Validates one flashvars source and returns it as an absolute http(s) URL.
  private toVideoURL(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.startsWith(OBFUSCATED_VIDEO_URL_PREFIX)) {
      return undefined;
    }

    return this.toAbsoluteHTTPURL(trimmed);
  }
}
