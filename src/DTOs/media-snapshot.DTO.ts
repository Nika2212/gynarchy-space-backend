import { ArrayMaxSize, IsArray, IsNumber, IsString, MaxLength, Min } from 'class-validator';
import { IMediaSnapshot } from '../shared/interfaces/media-snapshot.interface';

export class MediaSnapshotDTO implements IMediaSnapshot {
  @IsString()
  @MaxLength(500)
  title: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  duration: number;

  @IsString()
  @MaxLength(100)
  postedAt: string;

  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  thumbnailSrc: string[];
}
