import { IEntity } from './entity.interface';

export interface IMedia extends IEntity {
  isLiked?: boolean;
  isFavorite?: boolean;
  isHidden?: boolean;
  watchedAt?: Date;
  watchedTimes?: number;
  watchPositionAt?: number;
}