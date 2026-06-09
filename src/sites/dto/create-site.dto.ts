import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateSiteDto {
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  siteCode!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  siteName!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  clientName?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
