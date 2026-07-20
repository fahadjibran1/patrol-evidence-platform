import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { LicencesService } from './licences.service';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { CurrentAdmin } from '@/common/decorators/current-admin.decorator';
import { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { PaginationQueryDto, paginate } from '@/common/dto/pagination.dto';
import {
  CreateDraftLicenceDto,
  IssueLicenceDto,
  ListLicencesQueryDto,
  RenewLicenceDto,
  RevealLicenceDto,
} from './dto/licence.dto';
import { IssueExistingLicenceDto, RevokeLicenceDto, SuspendLicenceDto } from './dto/licence-actions.dto';
import { CreateInstallationDto, UpdateInstallationDto } from './dto/installation.dto';
import { Roles } from '@/common/decorators/roles.decorator';

@ApiTags('licences')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/licences')
export class LicencesController {
  constructor(private readonly licencesService: LicencesService) {}

  @Get()
  list(@Query() pagination: PaginationQueryDto, @Query() filters: ListLicencesQueryDto) {
    return this.licencesService
      .list({
        page: pagination.page ?? 1,
        pageSize: pagination.pageSize ?? 20,
        customerId: filters.customerId,
        search: filters.search,
      })
      .then(({ items, total }) => paginate(items, total, pagination.page ?? 1, pagination.pageSize ?? 20));
  }

  @Post('draft')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  createDraft(@CurrentAdmin() admin: AuthenticatedAdmin, @Body() dto: CreateDraftLicenceDto) {
    return this.licencesService.createDraft(admin, dto);
  }

  @Post('issue')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  issue(@CurrentAdmin() admin: AuthenticatedAdmin, @Body() dto: IssueLicenceDto) {
    return this.licencesService.issueImmediately(admin, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.licencesService.findOne(id);
  }

  @Post(':id/issue')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  issueDraft(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') id: string,
    @Body() dto: IssueExistingLicenceDto,
  ) {
    return this.licencesService.issueExisting(admin, id, dto);
  }

  @Post(':id/renew')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  renew(@CurrentAdmin() admin: AuthenticatedAdmin, @Param('id') id: string, @Body() dto: RenewLicenceDto) {
    return this.licencesService.renew(admin, id, dto);
  }

  @Post(':id/suspend')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  suspend(@CurrentAdmin() admin: AuthenticatedAdmin, @Param('id') id: string, @Body() dto: SuspendLicenceDto) {
    return this.licencesService.suspend(admin, id, dto);
  }

  @Post(':id/reinstate')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  reinstate(@CurrentAdmin() admin: AuthenticatedAdmin, @Param('id') id: string) {
    return this.licencesService.reinstate(admin, id);
  }

  @Post(':id/revoke')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  revoke(@CurrentAdmin() admin: AuthenticatedAdmin, @Param('id') id: string, @Body() dto: RevokeLicenceDto) {
    return this.licencesService.revoke(admin, id, dto);
  }

  @Post(':id/reveal')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  reveal(@CurrentAdmin() admin: AuthenticatedAdmin, @Param('id') id: string, @Body() dto: RevealLicenceDto) {
    return this.licencesService.reveal(admin, id, dto);
  }

  @Post(':id/installations')
  addInstallation(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') id: string,
    @Body() dto: CreateInstallationDto,
  ) {
    return this.licencesService.addInstallation(admin, id, dto);
  }

  @Patch(':id/installations/:installationId')
  updateInstallation(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') id: string,
    @Param('installationId') installationId: string,
    @Body() dto: UpdateInstallationDto,
  ) {
    return this.licencesService.updateInstallation(admin, id, installationId, dto);
  }
}
