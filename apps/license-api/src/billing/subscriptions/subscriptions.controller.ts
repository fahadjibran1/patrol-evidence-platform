import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentAdmin } from '@/common/decorators/current-admin.decorator';
import type { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { SubscriptionsService } from './subscriptions.service';
import {
  CancelSubscriptionDto,
  ChangeSubscriptionPlanDto,
  CreateSubscriptionDto,
  ListSubscriptionsQueryDto,
} from './dto/subscription.dto';

@ApiTags('billing-subscriptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/billing/subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get()
  list(@Query() query: ListSubscriptionsQueryDto) {
    return this.subscriptionsService.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.subscriptionsService.getById(id);
  }

  @Post()
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  create(@CurrentAdmin() admin: AuthenticatedAdmin, @Body() dto: CreateSubscriptionDto) {
    return this.subscriptionsService.create(admin, dto);
  }

  @Post(':id/activate')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  activate(@CurrentAdmin() admin: AuthenticatedAdmin, @Param('id') id: string) {
    return this.subscriptionsService.activate(admin, id);
  }

  @Post(':id/change-plan')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  changePlan(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') id: string,
    @Body() dto: ChangeSubscriptionPlanDto,
  ) {
    return this.subscriptionsService.changePlan(admin, id, dto);
  }

  @Post(':id/cancel')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  cancel(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') id: string,
    @Body() dto: CancelSubscriptionDto,
  ) {
    return this.subscriptionsService.cancel(admin, id, dto);
  }

  @Post(':id/resume')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  resume(@CurrentAdmin() admin: AuthenticatedAdmin, @Param('id') id: string) {
    return this.subscriptionsService.resume(admin, id);
  }

  @Post(':id/renew')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  renew(@CurrentAdmin() admin: AuthenticatedAdmin, @Param('id') id: string) {
    return this.subscriptionsService.renew(admin, id);
  }

  @Post(':id/suspend')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  suspend(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.subscriptionsService.suspend(admin, id, body?.reason);
  }

  @Post(':id/expire')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  expire(@CurrentAdmin() admin: AuthenticatedAdmin, @Param('id') id: string) {
    return this.subscriptionsService.expire(admin, id);
  }
}
