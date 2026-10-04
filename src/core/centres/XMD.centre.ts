import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { KtPlayerCentre } from './kt-player.centre';

@Injectable()
export class XMDCentre extends KtPlayerCentre {
  // Reads the XMD base URL from config and sets up the shared centre client.
  constructor(configService: ConfigService) {
    super(configService, 'XMD');
  }

  // Listing thumbnails point at 320x180 screenshots; the full-size ones live under videos_sources.
  protected pickThumbnail(attributes: Record<string, string>): string | undefined {
    return attributes['data-original']?.replace('videos_screenshots', 'videos_sources')?.replace('320x180', 'screenshots');
  }
}
