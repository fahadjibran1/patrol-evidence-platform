import { LicensePlan, LicenseStatus, NotificationStatus, PaymentStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

class DateRangeQueryDto {
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class CustomersExportQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class LicencesExportQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsEnum(LicenseStatus)
  status?: LicenseStatus;

  @IsOptional()
  @IsEnum(LicensePlan)
  plan?: LicensePlan;

  @IsOptional()
  @IsUUID()
  customerId?: string;
}

export class RenewalsExportQueryDto extends DateRangeQueryDto {}

export class RevenueExportQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;
}

export class NotificationsExportQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsEnum(NotificationStatus)
  status?: NotificationStatus;
}

export class AuditExportQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;
}

export class BillingExportQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsUUID()
  organisationId?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
