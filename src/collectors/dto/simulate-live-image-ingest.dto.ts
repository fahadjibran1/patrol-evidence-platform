import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SimulateLiveImageIngestDto {
  @IsString()
  @MaxLength(32)
  siteCode!: string;

  @IsString()
  @MaxLength(128)
  externalGroupId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  messageExternalId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  groupId?: string;
}
