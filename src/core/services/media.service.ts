import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { PER_PAGE_SIZE, XMDCentre } from '../../centres/XMD.centre';
import { IFindAll } from '../../interfaces/query.interface';
import { IMediaContainer } from '../../interfaces/media-container.interface';
import { IMediaInfo } from '../../interfaces/media-info.interface';
import { IMeta } from '../../interfaces/meta.interface';
import axios from 'axios';
import type { Response } from 'express';
import { DatabaseService } from '../../database/database.service';
import { sql } from 'drizzle-orm';
import identifier = sql.identifier;
import { decryptShortTokenToUrl } from '../helpers/utils';
import { Console } from '../helpers/console';

@Injectable()
export class MediaService {
  constructor(
    private readonly xmdCentre: XMDCentre,
    private readonly databaseService: DatabaseService,
  ) {}

  public async findAll(query: IFindAll): Promise<IMediaContainer> {
    const medias: IMediaInfo[] = await this.xmdCentre.search(query.keyword, query.page);
    const meta: IMeta = {
      currentPage: query.page,
      isLastPage: medias.length < PER_PAGE_SIZE,
    };

    const mediaRows = await this.databaseService.upsertMedias(this.databaseService.mediasToRows(medias));

    return {
      medias: this.databaseService.rowsToMedias(mediaRows),
      meta,
    };
  }
  
  public async find(id: string, range: string, response: Response): Promise<void> {
    if (!id) {
      throw new NotFoundException('Invalid media id');
    }

    const getFromRemote = async (): Promise<void> => {
      const decryptedURL: string = await this.xmdCentre.getUrl(decryptShortTokenToUrl(id) as string);
      try {
        const remoteResponse = await axios({
          method: 'GET',
          url: decryptedURL,
          responseType: 'stream',
          headers: range ? { Range: range } : {}
        });
        const status = range ? HttpStatus.PARTIAL_CONTENT : HttpStatus.OK;

        response.status(status).set({
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Content-Range': remoteResponse.headers['content-range'],
          'Content-Length': remoteResponse.headers['content-length'],
        });

        remoteResponse.data.pipe(response);
      } catch (error) {
        response.status(HttpStatus.BAD_GATEWAY).send('Error fetching remote stream');
      }
    };
    const media = await this.databaseService.findMediaByIdentifier(id);

    if (media && media.isDownloaded) {
      Console.info('Should get from WASABI Storage');
    } else {
      return await getFromRemote();
    }
  }
}