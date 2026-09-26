import { IsNumber, Min } from 'class-validator';

export class WatchPositionDTO {
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  watchPositionAt: number;
}
