import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { ExportsService } from './exports.service';
import {
  AuditExportQueryDto,
  BillingExportQueryDto,
  CustomersExportQueryDto,
  LicencesExportQueryDto,
  NotificationsExportQueryDto,
  RenewalsExportQueryDto,
  RevenueExportQueryDto,
} from './dto/export-query.dto';

/**
 * CSV exports for the admin portal. All endpoints require authentication; revenue is
 * additionally restricted to ADMIN/SUPER_ADMIN since SUPPORT should not see financials.
 */
@ApiTags('exports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/exports')
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Get('customers.csv')
  async customers(@Query() query: CustomersExportQueryDto, @Res() res: Response): Promise<void> {
    const csv = await this.exportsService.customersCsv(query);
    this.sendCsv(res, 'customers.csv', csv);
  }

  @Get('licences.csv')
  async licences(@Query() query: LicencesExportQueryDto, @Res() res: Response): Promise<void> {
    const csv = await this.exportsService.licencesCsv(query);
    this.sendCsv(res, 'licences.csv', csv);
  }

  @Get('renewals.csv')
  async renewals(@Query() query: RenewalsExportQueryDto, @Res() res: Response): Promise<void> {
    const csv = await this.exportsService.renewalsCsv(query);
    this.sendCsv(res, 'renewals.csv', csv);
  }

  @Get('revenue.csv')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  async revenue(@Query() query: RevenueExportQueryDto, @Res() res: Response): Promise<void> {
    const csv = await this.exportsService.revenueCsv(query);
    this.sendCsv(res, 'revenue.csv', csv);
  }

  @Get('notifications.csv')
  async notifications(@Query() query: NotificationsExportQueryDto, @Res() res: Response): Promise<void> {
    const csv = await this.exportsService.notificationsCsv(query);
    this.sendCsv(res, 'notifications.csv', csv);
  }

  @Get('audit.csv')
  async audit(@Query() query: AuditExportQueryDto, @Res() res: Response): Promise<void> {
    const csv = await this.exportsService.auditCsv(query);
    this.sendCsv(res, 'audit.csv', csv);
  }

  @Get('subscriptions.csv')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  async subscriptions(@Query() query: BillingExportQueryDto, @Res() res: Response): Promise<void> {
    const csv = await this.exportsService.subscriptionsCsv(query);
    this.sendCsv(res, 'subscriptions.csv', csv);
  }

  @Get('invoices.csv')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  async invoices(@Query() query: BillingExportQueryDto, @Res() res: Response): Promise<void> {
    const csv = await this.exportsService.invoicesCsv(query);
    this.sendCsv(res, 'invoices.csv', csv);
  }

  @Get('billing-payments.csv')
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  async billingPayments(@Query() query: BillingExportQueryDto, @Res() res: Response): Promise<void> {
    const csv = await this.exportsService.billingPaymentsCsv(query);
    this.sendCsv(res, 'billing-payments.csv', csv);
  }

  @Get('plans.csv')
  async plans(@Res() res: Response): Promise<void> {
    const csv = await this.exportsService.plansCsv();
    this.sendCsv(res, 'plans.csv', csv);
  }

  private sendCsv(res: Response, filename: string, csv: string): void {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }
}
