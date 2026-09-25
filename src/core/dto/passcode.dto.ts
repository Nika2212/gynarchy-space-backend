import { IsNotEmpty, IsString } from 'class-validator';

export class PasscodeDto {
  @IsString()
  @IsNotEmpty()
  passcode: string;
}
