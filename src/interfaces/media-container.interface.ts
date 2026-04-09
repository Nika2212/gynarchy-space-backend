import { IMeta } from './meta.interface';
import { IMediaInfo } from './media-info.interface';

export interface IMediaContainer {
  meta: IMeta;
  medias: IMediaInfo[];
}