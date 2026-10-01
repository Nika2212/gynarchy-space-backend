import { IMediaInfo } from './media-info.interface';

// Every media the user has liked, favorited, downloaded, or started watching, with its flags.
export interface IMediaLibrary {
  medias: IMediaInfo[];
}
