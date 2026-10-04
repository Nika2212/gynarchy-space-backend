import { IMedia } from './media.interface';

export interface IMediaInfo extends IMedia {
  url: string;
  thumbnailSrc: string[];
  previewSrc?: string;
  source?: string;
  title: string;
  description: string;
  postedAt: string;
  duration: number;
}