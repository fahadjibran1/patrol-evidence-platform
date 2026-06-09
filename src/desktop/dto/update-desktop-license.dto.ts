import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateDesktopLicenseDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  companyName!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(200)
  licenseKey!: string;
}

