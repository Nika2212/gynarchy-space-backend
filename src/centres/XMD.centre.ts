import axios from 'axios';
import * as cheerio from 'cheerio';
import { AppConfigProcess } from '../main';
import { Console } from '../core/helpers/console';
import { InternalServerErrorException } from '@nestjs/common';
import { IMediaInfo } from '../interfaces/media-info.interface';
import { timeToMs } from '../core/helpers/time';
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'fs';
import path from 'path';

export class XMDCentre {
  private readonly base: string = AppConfigProcess.get<string>('XMD') as string;
  
  constructor() {
    void this.onInit();
  }

  public async search(keyword: string, page: number = 1): Promise<IMediaInfo[]> {
    const queryObject = {
      mode: 'async',
      function: 'get_block',
      block_id: 'list_videos_videos_list_search_result',
      q: keyword,
      from_videos: page,
      from_albums: page,
    };
    
    try {
      const response = await axios.get(`${this.base}/search/${keyword}`, {params: queryObject});

      if (response.status === 200) {
        return this.parseSearch(response.data);
      } else {
        Console.error(`An unexpected error occurred in XMDCentre Search ${response.statusText}`);
        return [];
      }
    } catch (e) {
      throw new InternalServerErrorException('An unexpected error occurred in XMDCentre ', e.message);
    }
  }

  public async getUrl(url: string): Promise<string> {
    try {
      const response = await axios.get(url);

      if (response.status === 200) {
        return this.parseAndGetMedia(response.data);
      } else {
        Console.error(`An unexpected error occurred in XMDCentre Search ${response.statusText}`);
        return '';
      }
    } catch (e) {
      throw new InternalServerErrorException('An unexpected error occurred in XMDCentre ', e.message);
    }
  }

  private parseSearch(content: string): IMediaInfo[] {
    const $ = cheerio.load(content);
    const items: IMediaInfo[] = [];
    const getScreenshotSeries = (url: string): string[] =>
      Array.from({ length: 6 }, (_, i) => url.replace(/\/\d+\.jpg$/, `/${i + 1}.jpg`));

    $('#list_videos_videos_list_search_result_items .item').each((index, element) => {
      const $el = $(element);

      const T = $el.find('strong.title').text().trim();
      const D = $el.find('.duration').text().trim();
      const P = $el.find('.added').text().trim();
      const TH = $el.find('img.thumb')
        .attr('data-original')
        ?.replace('videos_screenshots', 'videos_sources')
        ?.replace('320x180', 'screenshots') as string;
      const U = $el.find('a').attr('href') as string;

      items.push({
        title: T,
        duration: timeToMs(D),
        postedAt: P,
        thumbnailSrc: getScreenshotSeries(TH),
        url: U,
        remoteSrc: '',
        description: '',
      });
    });

    return items;
  }

  private parseAndGetMedia(content: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const virtualConsole = new VirtualConsole();
      const DOM_A = new JSDOM(content, { runScripts: 'dangerously', virtualConsole });
      const vars: object = DOM_A.window.flashvars;

      const scriptPath = path.join(process.cwd(), 'dist', 'assets', 'kt_player.js');
      const scriptContent = fs.readFileSync(path.resolve(scriptPath), 'utf8');

      const DOM_B = new JSDOM(`<!DOCTYPE html><div id="kt_player"></div>`, {
        runScripts: 'dangerously',
        url: 'http://localhost/',
      });
      const { window } = DOM_B;

      window.requestAnimationFrame = (cb) => setTimeout(cb, 0);

      try {
        const script = window.document.createElement('script');

        script.textContent = scriptContent;
        window.document.body.appendChild(script);
        window.kt_player('kt_player', '', '100%', '100%', vars);

        setTimeout(() => {
          try {
            const result = window.kvsplayer.kt_player.conf.video_alt_url || window.kvsplayer.kt_player.conf.video_url;
            window.close();
            resolve(result);
          } catch (e) {
            reject(new Error('Decryption failed: ' + e.message));
          }
        }, 100);
      } catch (err) {
        reject(err);
      }
    });
  }
  
  private async onInit(): Promise<void> {
    await this.check();
  }
  
  private async check(): Promise<void> {
    try {
      const response = await axios.head(this.base);
      
      if (response.status === 200) {
        Console.success(`XMDCentre initialization successfully`);
      } else {
        Console.error(`XMDCentre initialization error: ${response.statusText}`);
      }
    } catch (error) {
      Console.error(`XMDCentre initialization error: ${error}`);
    }
  }
}