import { IEntity } from './entity.interface';

export interface IMedia extends IEntity {
  isDownloaded?: boolean;
  isLiked?: boolean;
  isFavorite?: boolean;
  watchedAt?: Date;
  watchedTimes?: number;
  watchPositionAt?: number;
  localSrc?: string;
}