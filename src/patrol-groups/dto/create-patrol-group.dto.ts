import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PatrolSourceType } from '@/common/enums/patrol-source-type.enum';

export class CreatePatrolGroupDto {
  @IsUUID()
  siteId!: string;

  @IsString()
  @MaxLength(150)
  groupName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  externalGroupId?: string;

  @IsOptional()
  @IsEnum(PatrolSourceType)
  sourceType?: PatrolSourceType;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  linkedAccountId?: string;
}
