import { IMediaInfo } from './media-info.interface';

export interface IAlbumMedia extends IMediaInfo {
  addedAt: Date;
}

export interface IAlbum {
  id: string;
  name: string;
  createdAt: Date;
  medias: IAlbumMedia[];
}

export interface IAlbumList {
  albums: IAlbum[];
}
