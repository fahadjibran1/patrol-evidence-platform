import { IsOptional, IsString, MaxLength } from 'class-validator';

export class VerifyDesktopSetupDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  siteCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalGroupId?: string;
}
