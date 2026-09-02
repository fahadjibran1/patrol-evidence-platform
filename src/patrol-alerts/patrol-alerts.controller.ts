import { Controller, Get, Param, Patch, Post, Body, UseGuards } from '@nestjs/common';
import { PatrolAlertsService } from './patrol-alerts.service';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { UserRole } from '@/common/enums/user-role.enum';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/auth/interfaces/authenticated-request.interface';
import { PatrolAlert } from './entities/patrol-alert.entity';
import { CreatePatrolAlertDto } from './dto/create-patrol-alert.dto';

import { LicenceFeatureGuard, RequireLicenceFeature } from '@/licensing/licence-feature.guard';

@Controller('patrol-alerts')
@UseGuards(JwtAuthGuard, RolesGuard, LicenceFeatureGuard)
export class PatrolAlertsController {
  constructor(private readonly patrolAlertsService: PatrolAlertsService) {}

  @Post()
  @RequireLicenceFeature('alerts')
  @Roles(UserRole.GUARD)
  create(@Body() dto: CreatePatrolAlertDto, @CurrentUser() user: AuthenticatedUser): Promise<PatrolAlert> {
    return this.patrolAlertsService.createGuardAlert(dto, user);
  }

  @Get()
  @RequireLicenceFeature('alerts')
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN, UserRole.GUARD)
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<PatrolAlert[]> {
    return this.patrolAlertsService.findAll(user);
  }

  @Get(':id')
  @RequireLicenceFeature('alerts')
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN, UserRole.GUARD)
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<PatrolAlert> {
    return this.patrolAlertsService.findOne(id, user);
  }

  @Patch(':id/resolve')
  @RequireLicenceFeature('alerts')
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN)
  resolve(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<PatrolAlert> {
    return this.patrolAlertsService.resolve(id, user);
  }
}
