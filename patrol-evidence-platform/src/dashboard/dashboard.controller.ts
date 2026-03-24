import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('live-sites')
  getLiveSites() {
    return this.dashboardService.getLiveSites();
  }

  @Get('missing-patrols')
  getMissingPatrols() {
    return this.dashboardService.getMissingPatrols();
  }

  @Get('daily-report')
  getDailyReport(@Query('siteCode') siteCode: string, @Query('date') date: string) {
    return this.dashboardService.getDailyReport(siteCode, date);
  }
}
