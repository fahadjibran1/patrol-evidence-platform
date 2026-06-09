import { BadRequestException, Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import {
  DashboardHourlyGuardStatusRow,
  DashboardHourlySafetyRow,
  DashboardOverview,
  DashboardService,
  DashboardSiteRow,
} from './dashboard.service';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { UserRole } from '@/common/enums/user-role.enum';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/auth/interfaces/authenticated-request.interface';
import { Response } from 'express';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.COMPANY_ADMIN)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  async overview(@CurrentUser() user: AuthenticatedUser, @Query('date') date?: string): Promise<DashboardOverview> {
    return this.withDateValidation(
      () => this.dashboardService.getOverview(user, date),
      {
        date: date?.trim() || new Date().toISOString().slice(0, 10),
        siteTotals: { active: 0, withScheduledSlots: 0 },
        slotTotals: { total: 0, Safe: 0, Missing: 0, Pending: 0 },
        imageTotals: { received: 0 },
        alerts: { unresolved: 0 },
        recentImages: [],
      },
    );
  }

  @Get('sites')
  async sites(@CurrentUser() user: AuthenticatedUser, @Query('date') date?: string): Promise<DashboardSiteRow[]> {
    return this.withDateValidation(() => this.dashboardService.getSiteBreakdown(user, date), []);
  }

  @Get('hourly-safety')
  async hourlySafety(
    @CurrentUser() user: AuthenticatedUser,
    @Query('date') date?: string,
  ): Promise<DashboardHourlySafetyRow[]> {
    return this.withDateValidation(() => this.dashboardService.getHourlySafety(user, date), []);
  }

  @Get('hourly-safety/export')
  async exportHourlySafety(
    @CurrentUser() user: AuthenticatedUser,
    @Query('date') date: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    await this.withDateValidation(async () => {
      const selectedDate = date?.trim() || new Date().toISOString().slice(0, 10);
      const csv = await this.dashboardService.exportHourlySafetyCsv(user, date);

      response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="hourly-safety-${selectedDate}.csv"`,
      );
      response.send(csv);
    });
  }

  @Get('hourly-guard-status')
  async hourlyGuardStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Query('date') date?: string,
    @Query('siteCode') siteCode?: string,
    @Query('hour') hour?: string,
    @Query('groupId') groupId?: string,
  ): Promise<DashboardHourlyGuardStatusRow[]> {
    return this.withDateValidation(
      () =>
        this.dashboardService.getHourlyGuardStatus(
          user,
          date,
          siteCode,
          hour === undefined ? undefined : Number(hour),
          groupId,
        ),
      [],
    );
  }

  @Get('hourly-guard-status/export')
  async exportHourlyGuardStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Query('date') date: string | undefined,
    @Query('siteCode') siteCode: string | undefined,
    @Query('hour') hour: string | undefined,
    @Query('groupId') groupId: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    await this.withDateValidation(async () => {
      const selectedDate = date?.trim() || new Date().toISOString().slice(0, 10);
      const csv = await this.dashboardService.exportHourlyGuardStatusCsv(
        user,
        date,
        siteCode,
        hour === undefined ? undefined : Number(hour),
        groupId,
      );

      response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="hourly-guard-status-${selectedDate}.csv"`,
      );
      response.send(csv);
    });
  }

  private async withDateValidation<T>(action: () => Promise<T>, fallback?: T): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof Error && error.message.includes('YYYY-MM-DD')) {
        throw new BadRequestException(error.message);
      }

      if (fallback !== undefined) {
        return fallback;
      }

      throw error;
    }
  }
}
