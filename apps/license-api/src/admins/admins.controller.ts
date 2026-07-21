import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { AdminsService } from './admins.service';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentAdmin } from '@/common/decorators/current-admin.decorator';
import { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { PaginationQueryDto, paginate, resolvePagination } from '@/common/dto/pagination.dto';
import { CreateAdminDto, ResetAdminPasswordDto, UpdateAdminDto } from './dto/admin.dto';

@ApiTags('admins')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
@Controller('admin/admins')
export class AdminsController {
  constructor(private readonly adminsService: AdminsService) {}

  @Get()
  list(@Query() query: PaginationQueryDto) {
    const { page, pageSize } = resolvePagination(query);
    return this.adminsService
      .list({ page, pageSize })
      .then(({ items, total }) => paginate(items, total, page, pageSize));
  }

  @Post()
  @Roles(AdminRole.SUPER_ADMIN)
  create(@CurrentAdmin() admin: AuthenticatedAdmin, @Body() dto: CreateAdminDto) {
    return this.adminsService.create(admin, dto);
  }

  @Patch(':id')
  update(@CurrentAdmin() admin: AuthenticatedAdmin, @Param('id') id: string, @Body() dto: UpdateAdminDto) {
    return this.adminsService.update(admin, id, dto);
  }

  @Post(':id/reset-password')
  resetPassword(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') id: string,
    @Body() dto: ResetAdminPasswordDto,
  ) {
    return this.adminsService.resetPassword(admin, id, dto);
  }

  @Post(':id/deactivate')
  deactivate(@CurrentAdmin() admin: AuthenticatedAdmin, @Param('id') id: string) {
    return this.adminsService.deactivate(admin, id);
  }
}
