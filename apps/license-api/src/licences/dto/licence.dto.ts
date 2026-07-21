import { LicensePlan, PaymentStatus } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { SUPPORTED_LICENCE_FEATURES } from '../licence-features';

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
  @Max(100)
  maxDevices!: number;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn([...SUPPORTED_LICENCE_FEATURES], { each: true })
  features?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class IssueLicenceDto extends CreateDraftLicenceDto {
  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  amountPence?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  paymentMethod?: string;

  @ValidateIf((dto: IssueLicenceDto) => dto.paymentStatus === PaymentStatus.PAID)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  paymentReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  invoiceReference?: string;

  @IsOptional()
  @IsString()
  @IsIn(['GBP'])
  currency?: string;
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
  @Max(100)
  maxDevices?: number;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn([...SUPPORTED_LICENCE_FEATURES], { each: true })
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

export class ListLicencesQueryDto extends PaginationQueryDto {
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
