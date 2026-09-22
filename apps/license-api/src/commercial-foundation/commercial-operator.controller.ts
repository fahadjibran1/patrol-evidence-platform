import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { CurrentAdmin } from '@/common/decorators/current-admin.decorator';
import type { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { CommercialIssuanceService } from './commercial-issuance.service';
import { CommercialStepUpService } from './commercial-step-up.service';
import { CommercialOperatorPermissionGuard } from './guards/commercial-operator-permission.guard';
import { RequireCommercialPermission } from './decorators/require-commercial-permission.decorator';
import { CommercialOperatorPermission } from './commercial-operator-permissions';
import { CommercialDecisionDto, CommercialStepUpDto } from './dto/commercial-operator.dto';

@ApiTags('commercial-operator')
@ApiBearerAuth()
@Controller('admin/commercial')
@UseGuards(JwtAuthGuard, CommercialOperatorPermissionGuard)
export class CommercialOperatorController {
  constructor(
    private readonly issuance: CommercialIssuanceService,
    private readonly stepUp: CommercialStepUpService,
  ) {}

  @Post('step-up')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @RequireCommercialPermission(CommercialOperatorPermission.APPROVE_ISSUANCE)
  createStepUp(@CurrentAdmin() admin: AuthenticatedAdmin, @Body() dto: CommercialStepUpDto) {
    return this.stepUp.create(admin, dto.password);
  }

  @Get('approvals')
  @RequireCommercialPermission(CommercialOperatorPermission.VIEW_APPROVAL_QUEUE)
  list(@CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.issuance.listApprovalQueue(admin);
  }

  @Get('approvals/:publicOrderId')
  @RequireCommercialPermission(CommercialOperatorPermission.VIEW_APPROVAL_QUEUE)
  detail(@Param('publicOrderId') publicOrderId: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.issuance.getApproval(publicOrderId, admin);
  }

  @Post('approvals/:publicOrderId/approve')
  @RequireCommercialPermission(CommercialOperatorPermission.APPROVE_ISSUANCE)
  approve(@Param('publicOrderId') publicOrderId: string, @CurrentAdmin() admin: AuthenticatedAdmin, @Headers('x-commercial-step-up') stepUpToken?: string) {
    return this.issuance.approve({ publicOrderId, admin, stepUpToken });
  }

  @Post('approvals/:publicOrderId/hold')
  @RequireCommercialPermission(CommercialOperatorPermission.HOLD_ORDER)
  hold(@Param('publicOrderId') publicOrderId: string, @CurrentAdmin() admin: AuthenticatedAdmin, @Body() dto: CommercialDecisionDto, @Headers('x-commercial-step-up') stepUpToken?: string) {
    return this.issuance.hold(publicOrderId, dto.reason, admin, stepUpToken);
  }

  @Post('approvals/:publicOrderId/reject')
  @RequireCommercialPermission(CommercialOperatorPermission.REJECT_ORDER)
  reject(@Param('publicOrderId') publicOrderId: string, @CurrentAdmin() admin: AuthenticatedAdmin, @Body() dto: CommercialDecisionDto, @Headers('x-commercial-step-up') stepUpToken?: string) {
    return this.issuance.reject(publicOrderId, dto.reason, admin, stepUpToken);
  }

  @Post('approvals/:publicOrderId/release-hold')
  @RequireCommercialPermission(CommercialOperatorPermission.RELEASE_HOLD)
  releaseHold(@Param('publicOrderId') publicOrderId: string, @CurrentAdmin() admin: AuthenticatedAdmin, @Body() dto: CommercialDecisionDto, @Headers('x-commercial-step-up') stepUpToken?: string) {
    return this.issuance.releaseHold(publicOrderId, dto.reason, admin, stepUpToken);
  }
}
