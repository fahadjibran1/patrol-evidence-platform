import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CustomerJwtAuthGuard } from '@/customer-auth/guards/customer-jwt-auth.guard';
import { CurrentCustomer } from '@/customer-auth/decorators/current-customer.decorator';
import { AuthenticatedCustomer } from '@/customer-auth/interfaces/authenticated-customer.interface';
import { CustomerLicencesService } from './customer-licences.service';
import { CustomerDownloadsService } from '@/customer-downloads/customer-downloads.service';

@ApiTags('customer-licences')
@ApiBearerAuth()
@UseGuards(CustomerJwtAuthGuard)
@Controller('customer/licences')
export class CustomerLicencesController {
  constructor(
    private readonly licencesService: CustomerLicencesService,
    private readonly downloadsService: CustomerDownloadsService,
  ) {}

  @Get()
  list(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.licencesService.list(customer);
  }

  @Get(':id/download')
  async download(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.downloadsService.downloadCurrentActive(customer, id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(result.body);
  }

  @Get(':id')
  getOne(@CurrentCustomer() customer: AuthenticatedCustomer, @Param('id') id: string) {
    return this.licencesService.getOne(customer, id);
  }
}
