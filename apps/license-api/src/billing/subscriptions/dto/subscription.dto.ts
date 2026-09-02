import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { BillingInterval, SubscriptionStatus } from '@prisma/client';

export class CreateSubscriptionDto {
  @IsString()
  @MinLength(1)
  organisationId!: string;

  @IsString()
  @MinLength(1)
  planId!: string;

  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;

  @IsOptional()
  @IsBoolean()
  startTrial?: boolean;

  @IsOptional()
  @IsBoolean()
  autoRenew?: boolean;
}

export class ChangeSubscriptionPlanDto {
  @IsString()
  @MinLength(1)
  planId!: string;

  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class CancelSubscriptionDto {
  @IsOptional()
  @IsBoolean()
  atPeriodEnd?: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class ListSubscriptionsQueryDto {
  @IsOptional()
  @IsUUID()
  organisationId?: string;

  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
