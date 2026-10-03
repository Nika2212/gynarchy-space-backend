import { IEntity } from './entity.interface';

export interface IMedia extends IEntity {
  isLiked?: boolean;
  isFavorite?: boolean;
  isDownloaded?: boolean;
  likedAt?: Date;
  favoritedAt?: Date;
  watchedAt?: Date;
  watchedTimes?: number;
  watchPositionAt?: number;
}
