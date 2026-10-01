import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { MediaSnapshotDTO } from './media-snapshot.DTO';

// Body of PATCH /media/:id/like and /media/:id/favorite.
export class MediaFlagDTO {
  @ValidateNested()
  @Type(() => MediaSnapshotDTO)
  media: MediaSnapshotDTO;
}
