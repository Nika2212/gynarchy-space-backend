import type { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { promises as fs } from 'fs';
import { decryptShortTokenToURL } from '../../shared/url-token';
import { FVCCentre } from './FVC.centre';

const PLAYER = `
function kt_player(id, swf, width, height, flashvars) {
  window.kvsplayer = { kt_player: { conf: { video_url: flashvars.video_url.replace('function/0/', '') } } };
}
`;

const SEARCH_HTML = `
<div id="list_videos_videos_list_search_result_items">
  <div class="item">
    <a href="https://www.fvc.test/video/33018/full-title/" title="Mistress Tess - Keeping Our ashtray busy - Full Title">
      <div class="img">
        <img class="thumb lazy-load" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
          data-original="https://www.fvc.test/contents/videos_screenshots/33000/33018/320x180/2.jpg"
          data-webp="https://www.fvc.test/contents/videos_screenshots/33000/33018/336x189/2.jpg"
          data-preview="https://www.fvc.test/get_file/1/abc/33000/33018/33018_preview.mp4/" />
      </div>
      <strong class="title">Mistress Tess - Keeping Our ashtray bu...</strong>
      <div class="wrap line-holder">
        <div class="duration">12:56</div>
        <div class="added"><em>4 years ago</em></div>
      </div>
    </a>
  </div>
</div>
`;

const MEDIA_HTML = `
<script>
  var tc7ff1901fc = {
    video_id: '16971',
    license_code: '$514777816983421',
    video_url: 'function/0/https://www.fvc.test/get_file/1/d17/16000/16971/16971.mp4/?br=711',
    embed: '1'
  };
  window['player_obj'] = kt_player('kt_player', 'https://www.fvc.test/player/kt_player.swf?v=13.6.1', '100%', '100%', tc7ff1901fc);
</script>
`;

function config(fvc: string | undefined): ConfigService {
  return { get: (key: string) => (key === 'FVC' ? fvc : undefined) } as ConfigService;
}

function untoken(path: string | undefined): string | undefined {
  return path ? decryptShortTokenToURL(path.split('/').pop() as string) : undefined;
}

describe('FVCCentre (unit)', () => {
  let http: { get: jest.Mock; head: jest.Mock };

  beforeEach(() => {
    http = { get: jest.fn(), head: jest.fn().mockResolvedValue({}) };
    jest.spyOn(axios, 'create').mockReturnValue(http as never);
    jest.spyOn(fs, 'readFile').mockResolvedValue(PLAYER);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects a missing FVC base URL', () => {
    expect(() => new FVCCentre(config(undefined))).toThrow('FVC base URL is not configured');
  });

  it('searches with a trailing-slash path and the KVS block params', async () => {
    const centre = new FVCCentre(config('https://www.fvc.test/'));
    http.get.mockResolvedValue({ data: SEARCH_HTML });

    await centre.search('  Gynarchy Mistress ', 3);

    expect(http.get).toHaveBeenCalledWith(
      '/search/gynarchy-mistress/',
      expect.objectContaining({
        params: expect.objectContaining({ q: 'gynarchy-mistress', from_videos: 3, from_albums: 3, category_ids: '', sort_by: '' }),
      }),
    );
  });

  it('parses cards with the full title, five screenshots, and a preview', async () => {
    const centre = new FVCCentre(config('https://www.fvc.test/'));
    http.get.mockResolvedValue({ data: SEARCH_HTML });

    const [card] = await centre.search('mistress');

    expect(card.title).toBe('Mistress Tess - Keeping Our ashtray busy - Full Title');
    expect(card.duration).toBe(776_000);
    expect(card.postedAt).toBe('4 years ago');
    expect(card.thumbnailSrc.map(untoken)).toEqual(
      [1, 2, 3, 4, 5].map((n) => `https://www.fvc.test/contents/videos_screenshots/33000/33018/320x180/${n}.jpg`),
    );
    expect(untoken(card.previewSrc)).toBe('https://www.fvc.test/get_file/1/abc/33000/33018/33018_preview.mp4/');
    expect(untoken(card.url)).toBe('https://www.fvc.test/video/33018/full-title/');
  });

  it('decodes the video URL through kt_player from randomly named flashvars', async () => {
    const centre = new FVCCentre(config('https://www.fvc.test/'));
    http.get.mockResolvedValue({ data: MEDIA_HTML });

    await expect(centre.getURL('https://www.fvc.test/video/16971/x/')).resolves.toBe(
      'https://www.fvc.test/get_file/1/d17/16000/16971/16971.mp4/?br=711',
    );
  });

  it('owns only its own site', () => {
    const centre = new FVCCentre(config('https://www.fvc.test/'));

    expect(centre.isAllowedAssetURL('https://www.fvc.test/get_file/1/a.mp4')).toBe(true);
    expect(centre.isAllowedAssetURL('https://heavyfetish.com/videos/1/')).toBe(false);
  });
});
