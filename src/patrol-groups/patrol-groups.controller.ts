import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PatrolGroupsService } from './patrol-groups.service';
import { CreatePatrolGroupDto } from './dto/create-patrol-group.dto';
import { UpdatePatrolGroupDto } from './dto/update-patrol-group.dto';
import { PatrolGroup } from './entities/patrol-group.entity';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { UserRole } from '@/common/enums/user-role.enum';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/auth/interfaces/authenticated-request.interface';

@Controller('patrol-groups')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PatrolGroupsController {
  constructor(private readonly groupsService: PatrolGroupsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN)
  create(@Body() dto: CreatePatrolGroupDto, @CurrentUser() user: AuthenticatedUser): Promise<PatrolGroup> {
    return this.groupsService.create(dto, user);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN)
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<PatrolGroup[]> {
    return this.groupsService.findAll(user);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN)
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<PatrolGroup> {
    return this.groupsService.findOne(id, user);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN)
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePatrolGroupDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PatrolGroup> {
    return this.groupsService.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.groupsService.remove(id, user);
  }
}
