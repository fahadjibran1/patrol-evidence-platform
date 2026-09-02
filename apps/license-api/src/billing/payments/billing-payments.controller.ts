import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentAdmin } from '@/common/decorators/current-admin.decorator';
import type { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { BillingPaymentsService } from './billing-payments.service';
import { ListBillingPaymentsQueryDto, RecordManualPaymentDto } from './dto/billing-payment.dto';

@ApiTags('billing-payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/billing/payments')
export class BillingPaymentsController {
  constructor(private readonly billingPaymentsService: BillingPaymentsService) {}

  @Get()
  list(@Query() query: ListBillingPaymentsQueryDto) {
    return this.billingPaymentsService.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.billingPaymentsService.getById(id);
  }

  @Post('manual')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  recordManual(@CurrentAdmin() admin: AuthenticatedAdmin, @Body() dto: RecordManualPaymentDto) {
    return this.billingPaymentsService.recordManual(admin, dto);
  }
}
