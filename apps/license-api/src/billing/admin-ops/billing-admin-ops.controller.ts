import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRole, BillingInterval } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentAdmin } from '@/common/decorators/current-admin.decorator';
import type { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { BillingAdminOpsService } from './billing-admin-ops.service';

class OverrideCancelDto {
  @IsOptional()
  @IsBoolean()
  resume?: boolean;

  @IsOptional()
  @IsBoolean()
  atPeriodEnd?: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}

class GracePeriodDto {
  @IsInt()
  @Min(0)
  @Max(90)
  gracePeriodDays!: number;
}

class CycleDto {
  @IsEnum(BillingInterval)
  billingInterval!: BillingInterval;
}

class TransferDto {
  @IsString()
  @MinLength(1)
  targetOrganisationId!: string;
}

class CreditDto {
  @IsString()
  organisationId!: string;

  @IsOptional()
  @IsString()
  subscriptionId?: string;

  @IsInt()
  @Min(1)
  amount!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsString()
  @MinLength(3)
  reason!: string;
}

@ApiTags('admin-billing-ops')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/billing')
export class BillingAdminOpsController {
  constructor(private readonly ops: BillingAdminOpsService) {}

  @Get('reporting/self-service')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  reporting() {
    return this.ops.reporting();
  }

  @Post('subscriptions/:id/override-cancel')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  overrideCancel(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') id: string,
    @Body() dto: OverrideCancelDto,
  ) {
    return this.ops.overrideCancel(admin, id, dto);
  }

  @Post('subscriptions/:id/grace-period')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  grace(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') id: string,
    @Body() dto: GracePeriodDto,
  ) {
    return this.ops.adjustGracePeriod(admin, id, dto.gracePeriodDays);
  }

  @Post('subscriptions/:id/billing-cycle')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  cycle(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') id: string,
    @Body() dto: CycleDto,
  ) {
    return this.ops.changeBillingCycle(admin, id, dto.billingInterval);
  }

  @Post('subscriptions/:id/transfer')
  @Roles(AdminRole.SUPER_ADMIN)
  transfer(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') id: string,
    @Body() dto: TransferDto,
  ) {
    return this.ops.transferSubscription(admin, id, dto.targetOrganisationId);
  }

  @Post('credits')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  credit(@CurrentAdmin() admin: AuthenticatedAdmin, @Body() dto: CreditDto) {
    return this.ops.issueCredit(admin, dto);
  }
}
