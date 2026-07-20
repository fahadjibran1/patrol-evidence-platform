import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { CurrentAdmin } from '@/common/decorators/current-admin.decorator';
import { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { PaginationQueryDto, paginate } from '@/common/dto/pagination.dto';
import { CreateCustomerDto, SearchCustomersQueryDto, UpdateCustomerDto } from './dto/customer.dto';
import { Roles } from '@/common/decorators/roles.decorator';
import { AdminRole } from '@prisma/client';

@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  list(@Query() pagination: PaginationQueryDto, @Query() filters: SearchCustomersQueryDto) {
    return this.customersService
      .list({
        page: pagination.page ?? 1,
        pageSize: pagination.pageSize ?? 20,
        search: filters.search,
        status: filters.status,
      })
      .then(({ items, total }) => paginate(items, total, pagination.page ?? 1, pagination.pageSize ?? 20));
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
  licences(@Param('id') id: string) {
    return this.customersService.listLicences(id);
  }

  @Get(':id/payments')
  payments(@Param('id') id: string) {
    return this.customersService.listPayments(id);
  }

  @Get(':id/audit')
  audit(@Param('id') id: string) {
    return this.customersService.listAudit(id);
  }
}
