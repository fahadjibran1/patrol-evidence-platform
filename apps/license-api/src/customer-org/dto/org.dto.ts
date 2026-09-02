import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CustomerRole } from '@prisma/client';

export class UpdateMemberRoleDto {
  @ApiProperty({ enum: CustomerRole })
  @IsEnum(CustomerRole)
  role!: CustomerRole;
}

export class UpdateMemberActiveDto {
  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;
}

export class CreateInvitationDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  email!: string;

  @ApiProperty({ enum: CustomerRole })
  @IsEnum(CustomerRole)
  role!: CustomerRole;
}

export class UpdateOwnProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notifyLicence?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notifyGeneral?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notifySystem?: boolean;
}

export class UpdateOrgProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  technicalContactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  technicalContactEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  technicalContactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  defaultNotifyLicence?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  defaultNotifyGeneral?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  defaultNotifySystem?: boolean;
}
