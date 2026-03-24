import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

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
  @IsBoolean()
  active?: boolean;
}
