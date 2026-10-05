import { Type } from 'class-transformer';
import { IsOptional, ValidateNested } from 'class-validator';
import { MediaSnapshotDTO } from './media-snapshot.DTO';

// Body of POST /media/:id/download. The card is optional only when retrying a failed download.
export class DownloadDTO {
  @IsOptional()
  @ValidateNested()
  @Type(() => MediaSnapshotDTO)
  media?: MediaSnapshotDTO;
}
