import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JSDOM } from 'jsdom';
import { promises as fs } from 'fs';
import path from 'path';

import { BaseCentre, MediaExtractionException } from './base.centre';

const KT_PLAYER_TIMEOUT: number = 2000;
const KT_PLAYER_RESOLVE_DELAY: number = 200;
const KT_PLAYER_PATHS: string[] = [
  path.join(__dirname, '..', '..', '..', 'assets', 'kt_player.js'),
  path.join(process.cwd(), 'dist', 'assets', 'kt_player.js'),
  path.join(process.cwd(), 'src', 'assets', 'kt_player.js'),
];
const JSDOM_CONCURRENCY: number = 4;
const JSDOM_QUEUE_LIMIT: number = 8;

@Injectable()
export class XMDCentre extends BaseCentre {
  private ktPlayerCache: string | null = null;
  private jsdomInFlight = 0;
  private readonly jsdomQueue: Array<() => void> = [];

  // Reads the XMD base URL from config and sets up the shared centre client.
  constructor(configService: ConfigService) {
    super(configService, 'XMD');
  }

  // Listing thumbnails point at 320x180 screenshots; the full-size ones live under videos_sources.
  protected pickThumbnail(attributes: Record<string, string>): string | undefined {
    return attributes['data-original']?.replace('videos_screenshots', 'videos_sources')?.replace('320x180', 'screenshots');
  }

  // Runs kt_player against page flashvars and returns the video URL.
  protected async extractMediaURL(html: string): Promise<string> {
    const flashvars = this.extractFlashVars(html);
    const ktPlayerScript = await this.loadKtPlayer();

    return this.withJsdomSlot(() => this.runKtPlayer(flashvars, ktPlayerScript));
  }

  // Runs work inside a limited JSDOM slot so too many players do not pile up.
  private async withJsdomSlot<T>(run: () => Promise<T>): Promise<T> {
    await this.acquireJsdomSlot();
    try {
      return await run();
    } finally {
      this.releaseJsdomSlot();
    }
  }

  // Waits for a free JSDOM slot, or rejects when the queue is full.
  private acquireJsdomSlot(): Promise<void> {
    if (this.jsdomInFlight < JSDOM_CONCURRENCY) {
      this.jsdomInFlight += 1;
      return Promise.resolve();
    }

    if (this.jsdomQueue.length >= JSDOM_QUEUE_LIMIT) {
      throw new HttpException('Playback capacity exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }

    return new Promise((resolve) => {
      this.jsdomQueue.push(() => {
        this.jsdomInFlight += 1;
        resolve();
      });
    });
  }

  // Frees one JSDOM slot and starts the next waiting job.
  private releaseJsdomSlot(): void {
    this.jsdomInFlight = Math.max(0, this.jsdomInFlight - 1);
    const next = this.jsdomQueue.shift();
    if (next) {
      next();
    }
  }

  // Loads and caches the kt_player.js source from disk.
  private async loadKtPlayer(): Promise<string> {
    if (this.ktPlayerCache !== null) {
      return this.ktPlayerCache;
    }

    let lastError: NodeJS.ErrnoException | undefined;

    for (const candidate of KT_PLAYER_PATHS) {
      try {
        const content = await fs.readFile(candidate, 'utf8');
        this.ktPlayerCache = content;
        return content;
      } catch (error) {
        lastError = error as NodeJS.ErrnoException;
      }
    }

    if (lastError?.code === 'ENOENT') {
      throw new MediaExtractionException('kt_player.js missing');
    }
    throw new MediaExtractionException(`Failed to load kt_player.js: ${lastError?.message ?? 'unknown error'}`);
  }

  // Executes kt_player in JSDOM and reads the resolved video URL.
  private runKtPlayer(flashvars: Record<string, unknown>, scriptContent: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let timeout: NodeJS.Timeout | null = null;
      let resolveTimeout: NodeJS.Timeout | null = null;
      let dom: JSDOM | null = null;
      const rafTimerByID = new Map<number, ReturnType<typeof setTimeout>>();
      let nextRafID = 1;

      // Clears every fake requestAnimationFrame timer created for kt_player.
      const clearAllRafTimers = (): void => {
        for (const t of rafTimerByID.values()) {
          clearTimeout(t);
        }
        rafTimerByID.clear();
      };

      // Stops timers and closes the JSDOM window after extract succeeds or fails.
      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        if (resolveTimeout) {
          clearTimeout(resolveTimeout);
          resolveTimeout = null;
        }
        clearAllRafTimers();
        if (dom) {
          try {
            dom.window.close();
          } catch (err) {}
          dom = null;
        }
      };

      timeout = setTimeout(() => {
        cleanup();
        reject(new MediaExtractionException('kt_player timeout'));
      }, KT_PLAYER_TIMEOUT);

      try {
        dom = new JSDOM(`<!DOCTYPE html><div id="kt_player"></div>`, {
          runScripts: 'dangerously',
          url: 'http://localhost/',
        });

        const { window } = dom;
        // Stands in for requestAnimationFrame so kt_player can run in Node.
        window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
          const id = nextRafID++;
          const handle = setTimeout(() => {
            rafTimerByID.delete(id);
            try {
              cb(Date.now());
            } catch {
              /* script errors surface via kt_player path */
            }
          }, 0);
          rafTimerByID.set(id, handle);
          return id;
        };
        // Cancels one fake animation-frame timer by id.
        window.cancelAnimationFrame = (id: number): void => {
          const handle = rafTimerByID.get(id);
          if (handle !== undefined) {
            clearTimeout(handle);
            rafTimerByID.delete(id);
          }
        };

        const script = window.document.createElement('script');
        script.textContent = scriptContent;
        window.document.body.appendChild(script);

        (window as unknown as { kt_player: (...args: unknown[]) => void }).kt_player('kt_player', '', '100%', '100%', flashvars);

        resolveTimeout = setTimeout(() => {
          try {
            const conf = (window as unknown as { kvsplayer?: { kt_player?: { conf?: { video_alt_url?: string; video_url?: string } } } })?.kvsplayer?.kt_player?.conf;
            const videoURL = conf?.video_alt_url ?? conf?.video_url;

            if (!videoURL || typeof videoURL !== 'string') {
              throw new MediaExtractionException('video URL not resolved');
            }

            cleanup();
            resolve(videoURL);
          } catch (err) {
            cleanup();
            reject(err);
          }
        }, KT_PLAYER_RESOLVE_DELAY);
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  }
}
