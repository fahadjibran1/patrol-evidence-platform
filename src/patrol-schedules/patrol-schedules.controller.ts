import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PatrolSchedulesService } from './patrol-schedules.service';
import { CreatePatrolScheduleDto } from './dto/create-patrol-schedule.dto';
import { UpdatePatrolScheduleDto } from './dto/update-patrol-schedule.dto';
import { PatrolSchedule } from './entities/patrol-schedule.entity';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { UserRole } from '@/common/enums/user-role.enum';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/auth/interfaces/authenticated-request.interface';

@Controller('patrol-schedules')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PatrolSchedulesController {
  constructor(private readonly schedulesService: PatrolSchedulesService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN)
  create(@Body() dto: CreatePatrolScheduleDto, @CurrentUser() user: AuthenticatedUser): Promise<PatrolSchedule> {
    return this.schedulesService.create(dto, user);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN)
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<PatrolSchedule[]> {
    return this.schedulesService.findAll(user);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN)
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<PatrolSchedule> {
    return this.schedulesService.findOne(id, user);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN)
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePatrolScheduleDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PatrolSchedule> {
    return this.schedulesService.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.schedulesService.remove(id, user);
  }
}
