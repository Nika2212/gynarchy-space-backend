import { IMedia } from './media.interface';

export interface IMediaInfo extends IMedia {
  url: string;
  remoteSrc: string;
  thumbnailSrc: string[];
  title: string;
  description: string;
  postedAt: string;
  duration: number;
}