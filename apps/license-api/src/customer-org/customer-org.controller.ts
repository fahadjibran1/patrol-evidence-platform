import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CustomerPermission } from '@/customer-org/customer-permissions';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { Request } from 'express';
import { CustomerJwtAuthGuard } from '@/customer-auth/guards/customer-jwt-auth.guard';
import { CustomerPermissionsGuard } from '@/customer-auth/guards/customer-permissions.guard';
import { CurrentCustomer } from '@/customer-auth/decorators/current-customer.decorator';
import { RequireCustomerPermissions } from '@/customer-auth/decorators/require-customer-permissions.decorator';
import { AuthenticatedCustomer } from '@/customer-auth/interfaces/authenticated-customer.interface';
import { CustomerMembersService } from './customer-members.service';
import { CustomerInvitationsService } from './customer-invitations.service';
import { CustomerSessionsService } from './customer-sessions.service';
import { CustomerActivityService } from './customer-activity.service';
import {
  CreateInvitationDto,
  UpdateMemberActiveDto,
  UpdateMemberRoleDto,
  UpdateOrgProfileDto,
  UpdateOwnProfileDto,
} from './dto/org.dto';
import { CustomerOrgProfileService } from './customer-org-profile.service';

class ActivityQueryDto {
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

@ApiTags('customer-organisation')
@ApiBearerAuth()
@UseGuards(CustomerJwtAuthGuard, CustomerPermissionsGuard)
@Controller('customer')
export class CustomerOrgController {
  constructor(
    private readonly membersService: CustomerMembersService,
    private readonly invitationsService: CustomerInvitationsService,
    private readonly sessionsService: CustomerSessionsService,
    private readonly activityService: CustomerActivityService,
    private readonly orgProfileService: CustomerOrgProfileService,
  ) {}

  @Get('members')
  @RequireCustomerPermissions(CustomerPermission.MANAGE_USERS)
  listMembers(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.membersService.list(customer);
  }

  @Patch('members/:id/role')
  @RequireCustomerPermissions(CustomerPermission.MANAGE_USERS)
  updateRole(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Param('id') id: string,
    @Body() dto: UpdateMemberRoleDto,
    @Req() req: Request,
  ) {
    return this.membersService.updateRole(customer, id, dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Patch('members/:id/active')
  @RequireCustomerPermissions(CustomerPermission.MANAGE_USERS)
  setActive(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Param('id') id: string,
    @Body() dto: UpdateMemberActiveDto,
    @Req() req: Request,
  ) {
    return this.membersService.setActive(customer, id, dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('members/:id')
  @RequireCustomerPermissions(CustomerPermission.MANAGE_USERS)
  removeMember(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.membersService.remove(customer, id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('invitations')
  @RequireCustomerPermissions(CustomerPermission.MANAGE_INVITATIONS)
  listInvitations(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.invitationsService.list(customer);
  }

  @Post('invitations')
  @RequireCustomerPermissions(CustomerPermission.MANAGE_INVITATIONS)
  createInvitation(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Body() dto: CreateInvitationDto,
    @Req() req: Request,
  ) {
    return this.invitationsService.invite(customer, dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('invitations/:id/cancel')
  @RequireCustomerPermissions(CustomerPermission.MANAGE_INVITATIONS)
  cancelInvitation(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.invitationsService.cancel(customer, id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('invitations/:id/resend')
  @RequireCustomerPermissions(CustomerPermission.MANAGE_INVITATIONS)
  resendInvitation(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.invitationsService.resend(customer, id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('sessions')
  @RequireCustomerPermissions(CustomerPermission.MANAGE_SESSIONS)
  listSessions(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.sessionsService.list(customer);
  }

  @Post('sessions/:id/revoke')
  @RequireCustomerPermissions(CustomerPermission.MANAGE_SESSIONS)
  revokeSession(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.sessionsService.revoke(customer, id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('sessions/revoke-others')
  @RequireCustomerPermissions(CustomerPermission.MANAGE_SESSIONS)
  revokeOtherSessions(@CurrentCustomer() customer: AuthenticatedCustomer, @Req() req: Request) {
    return this.sessionsService.revokeOthers(customer, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('activity')
  @RequireCustomerPermissions(CustomerPermission.VIEW_ACTIVITY)
  listActivity(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Query() query: ActivityQueryDto,
  ) {
    return this.activityService.list(customer, query);
  }

  @Get('organisation')
  @RequireCustomerPermissions(CustomerPermission.VIEW_DASHBOARD)
  getOrganisation(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.orgProfileService.getOrganisation(customer);
  }

  @Patch('organisation')
  @RequireCustomerPermissions(CustomerPermission.MANAGE_ORG_PROFILE)
  updateOrganisation(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Body() dto: UpdateOrgProfileDto,
    @Req() req: Request,
  ) {
    return this.orgProfileService.updateOrganisation(customer, dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Patch('profile')
  @RequireCustomerPermissions(CustomerPermission.MANAGE_OWN_PROFILE)
  updateOwnProfile(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Body() dto: UpdateOwnProfileDto,
    @Req() req: Request,
  ) {
    return this.orgProfileService.updateOwnProfile(customer, dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
