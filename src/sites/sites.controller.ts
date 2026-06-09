import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
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
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<Site[]> {
    return this.sitesService.findAll(user);
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
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.sitesService.remove(id, user);
  }
}
