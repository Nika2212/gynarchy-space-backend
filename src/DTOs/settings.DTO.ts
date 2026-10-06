import { IsBoolean, IsOptional } from 'class-validator';

// Body of PATCH /settings. Only the sent fields change.
export class SettingsDTO {
  @IsOptional()
  @IsBoolean()
  nativeSearch?: boolean;

  @IsOptional()
  @IsBoolean()
  randomizeFeed?: boolean;

  @IsOptional()
  @IsBoolean()
  randomizeSearch?: boolean;
}
