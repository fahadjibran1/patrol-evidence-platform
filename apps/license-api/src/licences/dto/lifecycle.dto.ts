import { LicensePlan } from '@prisma/client';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class RenewLicenceLifecycleDto {
  @IsIn(['MONTHLY', 'ANNUAL', 'CUSTOM'])
  renewalPeriod!: 'MONTHLY' | 'ANNUAL' | 'CUSTOM';

  @ValidateIf((dto: RenewLicenceLifecycleDto) => dto.renewalPeriod === 'CUSTOM' || dto.validFrom !== undefined)
  @IsOptional()
  @IsString()
  validFrom?: string;

  @ValidateIf((dto: RenewLicenceLifecycleDto) => dto.renewalPeriod === 'CUSTOM')
  @IsString()
  validUntil?: string;

  @IsOptional()
  @IsEnum(LicensePlan)
  plan?: LicensePlan;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxDevices?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;

  @IsOptional()
  @IsBoolean()
  emailAfterRenewal?: boolean;

  @IsOptional()
  @IsEmail()
  recipientEmail?: string;

  @IsOptional()
  @IsBoolean()
  allowDateOverride?: boolean;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class ReissueLicenceDto {
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  @IsOptional()
  @IsBoolean()
  emailAfterReissue?: boolean;

  @IsOptional()
  @IsEmail()
  recipientEmail?: string;
}

export class SuspendLicenceLifecycleDto {
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class ReactivateLicenceDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;

  @IsString()
  @MinLength(1)
  password!: string;

  @IsOptional()
  @IsBoolean()
  emailUpdatedLicence?: boolean;

  @IsOptional()
  @IsEmail()
  recipientEmail?: string;
}

export class RevokeLicenceLifecycleDto {
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;

  @IsString()
  @MinLength(1)
  confirmationText!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class ChangePlanDto {
  @IsEnum(LicensePlan)
  newPlan!: LicensePlan;

  @IsOptional()
  @IsString()
  validFrom?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  @IsOptional()
  @IsBoolean()
  emailUpdatedLicence?: boolean;

  @IsOptional()
  @IsEmail()
  recipientEmail?: string;
}

export class ChangeDeviceLimitDto {
  @IsInt()
  @Min(1)
  @Max(100)
  maxDevices!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  @IsOptional()
  @IsBoolean()
  emailUpdatedLicence?: boolean;

  @IsOptional()
  @IsEmail()
  recipientEmail?: string;
}
