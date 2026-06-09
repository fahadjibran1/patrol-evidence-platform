import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IncidentsService } from './incidents.service';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { UserRole } from '@/common/enums/user-role.enum';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/auth/interfaces/authenticated-request.interface';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { UpdateIncidentStatusDto } from './dto/update-incident-status.dto';
import { Incident } from './entities/incident.entity';

@Controller('incidents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN, UserRole.GUARD)
  create(@Body() dto: CreateIncidentDto, @CurrentUser() user: AuthenticatedUser): Promise<Incident> {
    return this.incidentsService.create(dto, user);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN, UserRole.GUARD)
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<Incident[]> {
    return this.incidentsService.findAll(user);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN, UserRole.GUARD)
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<Incident> {
    return this.incidentsService.findOne(id, user);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateIncidentStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Incident> {
    return this.incidentsService.updateStatus(id, dto, user);
  }
}
