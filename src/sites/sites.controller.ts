import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { SitesService } from './sites.service';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';
import { Site } from './entities/site.entity';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { UserRole } from '@/common/enums/user-role.enum';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/auth/interfaces/authenticated-request.interface';

class ArchiveSiteDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  confirmSiteCode?: string;
}

@Controller('sites')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SitesController {
  constructor(private readonly sitesService: SitesService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN)
  create(@Body() dto: CreateSiteDto, @CurrentUser() user: AuthenticatedUser): Promise<Site> {
    return this.sitesService.create(dto, user);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN, UserRole.GUARD)
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<Site[]> {
    return this.sitesService.findAll(user, includeArchived === 'true' || includeArchived === '1');
  }

  @Get(':id/archive-preview')
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN)
  getArchivePreview(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.sitesService.getArchivePreview(id, user);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN, UserRole.GUARD)
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<Site> {
    return this.sitesService.findOne(id, user);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateSiteDto, @CurrentUser() user: AuthenticatedUser): Promise<Site> {
    return this.sitesService.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN)
  archive(
    @Param('id') id: string,
    @Body() dto: ArchiveSiteDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Site> {
    return this.sitesService.archive(id, user, dto.reason);
  }

  @Post(':id/restore')
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN)
  restore(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<Site> {
    return this.sitesService.restore(id, user);
  }
}
