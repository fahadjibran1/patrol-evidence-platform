import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSiteDto {
  @IsString()
  @MaxLength(20)
  siteCode!: string;

  @IsString()
  @MaxLength(120)
  siteName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  clientName?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
