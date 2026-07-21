import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentAdmin } from '@/common/decorators/current-admin.decorator';
import { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { paginate, resolvePagination } from '@/common/dto/pagination.dto';
import { CreatePaymentDto, ListPaymentsQueryDto, UpdatePaymentDto } from './dto/payment.dto';

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  list(@Query() query: ListPaymentsQueryDto) {
    const { page, pageSize } = resolvePagination(query);
    return this.paymentsService
      .list({
        page,
        pageSize,
        customerId: query.customerId,
        licenceId: query.licenceId,
        paymentStatus: query.paymentStatus,
      })
      .then(({ items, total }) => paginate(items, total, page, pageSize));
  }

  @Post()
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  create(@CurrentAdmin() admin: AuthenticatedAdmin, @Body() dto: CreatePaymentDto) {
    return this.paymentsService.create(admin, dto);
  }

  @Patch(':id')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  update(@CurrentAdmin() admin: AuthenticatedAdmin, @Param('id') id: string, @Body() dto: UpdatePaymentDto) {
    return this.paymentsService.update(admin, id, dto);
  }
}
