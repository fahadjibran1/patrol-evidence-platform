import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ComplianceService, GenerateSlotsResult } from './compliance.service';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { UserRole } from '@/common/enums/user-role.enum';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/auth/interfaces/authenticated-request.interface';

@Controller('compliance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN)
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Post('generate-slots')
  generateSlots(@Body('date') date: string, @CurrentUser() user: AuthenticatedUser): Promise<GenerateSlotsResult> {
    return this.complianceService.generateSlotsForDate(date, user);
  }

  @Post('generate-today')
  generateToday(@CurrentUser() user: AuthenticatedUser): Promise<GenerateSlotsResult> {
    return this.complianceService.generateToday(user);
  }
}
