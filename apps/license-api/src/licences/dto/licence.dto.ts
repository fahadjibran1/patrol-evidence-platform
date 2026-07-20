import { InstallationStatus, LicensePlan } from '@prisma/client';
import {
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

export class CreateDraftLicenceDto {
  @IsUUID()
  customerId!: string;

  @IsEnum(LicensePlan)
  plan!: LicensePlan;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsInt()
  @Min(1)
  maxDevices!: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];

  @IsOptional()
  @IsString()
  notes?: string;
}

export class IssueLicenceDto extends CreateDraftLicenceDto {
  @IsOptional()
  @IsEmail()
  customerEmail?: string;
}

export class RenewLicenceDto {
  @IsOptional()
  @IsEnum(LicensePlan)
  plan?: LicensePlan;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxDevices?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];

  @IsOptional()
  @IsString()
  notes?: string;
}

export class RevealLicenceDto {
  @IsString()
  @MinLength(8)
  password!: string;
}

export class ListLicencesQueryDto {
  @IsOptional()
  @IsEnum(LicensePlan)
  plan?: LicensePlan;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;
}
