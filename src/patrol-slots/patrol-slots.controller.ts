import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PatrolSlotsService } from './patrol-slots.service';
import { PatrolSlot } from './entities/patrol-slot.entity';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { UserRole } from '@/common/enums/user-role.enum';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/auth/interfaces/authenticated-request.interface';
import { getOperationalDateUtcBounds } from '@/common/utils/patrol-time.util';

@Controller('patrol-slots')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PatrolSlotsController {
  constructor(private readonly patrolSlotsService: PatrolSlotsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN, UserRole.GUARD)
  async findBySiteAndDate(
    @Query('siteCode') siteCode: string,
    @Query('date') date: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PatrolSlot[]> {
    if (!siteCode || !date) {
      throw new BadRequestException('siteCode and date query params are required');
    }

    let dayStart: Date;
    let dayEnd: Date;
    try {
      const bounds = getOperationalDateUtcBounds(date);
      dayStart = bounds.startInclusive;
      dayEnd = new Date(bounds.endExclusive.getTime() - 1);
    } catch {
      throw new BadRequestException('date must use YYYY-MM-DD format');
    }

    return this.patrolSlotsService.findBySiteCodeAndDate(siteCode.trim().toUpperCase(), dayStart, dayEnd, user);
  }
}
