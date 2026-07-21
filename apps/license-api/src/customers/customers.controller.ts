import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { CustomersService } from './customers.service';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { CurrentAdmin } from '@/common/decorators/current-admin.decorator';
import { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { paginate, resolvePagination } from '@/common/dto/pagination.dto';
import { CreateCustomerDto, SearchCustomersQueryDto, UpdateCustomerDto } from './dto/customer.dto';
import { Roles } from '@/common/decorators/roles.decorator';

@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  list(@Query() query: SearchCustomersQueryDto) {
    const { page, pageSize } = resolvePagination(query);
    return this.customersService
      .list({
        page,
        pageSize,
        search: query.search,
        status: query.status,
      })
      .then(({ items, total }) => paginate(items, total, page, pageSize));
  }

  @Post()
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  create(@CurrentAdmin() admin: AuthenticatedAdmin, @Body() dto: CreateCustomerDto) {
    return this.customersService.create(admin, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }

  @Patch(':id')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.SUPPORT)
  update(@CurrentAdmin() admin: AuthenticatedAdmin, @Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customersService.update(admin, id, dto);
  }

  @Get(':id/licences')
  async licences(@Param('id') id: string) {
    const items = await this.customersService.listLicences(id);
    return paginate(items, items.length, 1, Math.max(items.length, 1));
  }

  @Get(':id/payments')
  async payments(@Param('id') id: string) {
    const items = await this.customersService.listPayments(id);
    return paginate(items, items.length, 1, Math.max(items.length, 1));
  }

  @Get(':id/audit')
  async audit(@Param('id') id: string) {
    const items = await this.customersService.listAudit(id);
    return paginate(items, items.length, 1, Math.max(items.length, 1));
  }
}
