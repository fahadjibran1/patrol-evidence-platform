import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentAdmin } from '@/common/decorators/current-admin.decorator';
import type { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { SupportOpsService } from './support-ops.service';

class UnlockAccountDto {
  @IsIn(['admin', 'customer'])
  accountType!: 'admin' | 'customer';

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsBoolean()
  reactivate?: boolean;
}

class ResetCustomerStateDto {
  @IsOptional()
  @IsBoolean()
  clearPendingCheckout?: boolean;

  @IsOptional()
  @IsBoolean()
  clearScheduledPlanChange?: boolean;

  @IsOptional()
  @IsBoolean()
  clearCancellation?: boolean;

  @IsOptional()
  @IsBoolean()
  clearPastDue?: boolean;
}

class RebuildLicenceDto {
  @IsString()
  @MinLength(1)
  subscriptionId!: string;
}

@ApiTags('admin-support-ops')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/support')
export class SupportOpsController {
  constructor(private readonly support: SupportOpsService) {}

  @Get('notifications/failed')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.SUPPORT)
  failedNotifications(@Query('limit') limit?: string) {
    return this.support.listFailedNotifications(limit ? Number(limit) : 50);
  }

  @Post('notifications/:id/resend')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.SUPPORT)
  resendNotification(@CurrentAdmin() admin: AuthenticatedAdmin, @Param('id') id: string) {
    return this.support.resendNotification(admin, id);
  }

  @Post('webhooks/:eventId/reprocess')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  reprocessWebhook(@CurrentAdmin() admin: AuthenticatedAdmin, @Param('eventId') eventId: string) {
    return this.support.reprocessWebhook(admin, eventId);
  }

  @Post('licences/rebuild')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  rebuildLicence(@CurrentAdmin() admin: AuthenticatedAdmin, @Body() dto: RebuildLicenceDto) {
    return this.support.rebuildLicence(admin, dto.subscriptionId);
  }

  @Post('stripe/resync/:organisationId')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  resyncStripe(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('organisationId') organisationId: string,
  ) {
    return this.support.resynchroniseStripe(admin, organisationId);
  }

  @Post('accounts/unlock')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  unlock(@CurrentAdmin() admin: AuthenticatedAdmin, @Body() dto: UnlockAccountDto) {
    return this.support.unlockAccount(admin, dto);
  }

  @Post('organisations/:id/reset-state')
  @Roles(AdminRole.SUPER_ADMIN)
  resetState(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') id: string,
    @Body() dto: ResetCustomerStateDto,
  ) {
    return this.support.resetCustomerState(admin, id, dto);
  }
}
