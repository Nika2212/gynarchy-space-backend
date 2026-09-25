import { IsNotEmpty, IsString } from 'class-validator';

export class PasscodeDTO {
  @IsString()
  @IsNotEmpty()
  passcode: string;
}
