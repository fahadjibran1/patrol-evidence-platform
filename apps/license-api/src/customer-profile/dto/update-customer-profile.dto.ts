import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateCustomerProfileDto {
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
  @IsEmail()
  technicalContactEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  technicalContactPhone?: string;

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
