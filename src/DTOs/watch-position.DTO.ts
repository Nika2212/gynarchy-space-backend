import { Type } from 'class-transformer';
import { IsNumber, Min, ValidateNested } from 'class-validator';
import { MediaSnapshotDTO } from './media-snapshot.DTO';

export class WatchPositionDTO {
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  watchPositionAt: number;

  @ValidateNested()
  @Type(() => MediaSnapshotDTO)
  media: MediaSnapshotDTO;
}
