import { Body, Controller, Post } from '@nestjs/common';
import { ComplianceService, GenerateSlotsResult } from './compliance.service';

@Controller('compliance')
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Post('generate-slots')
  generateSlots(@Body('date') date: string): Promise<GenerateSlotsResult> {
    return this.complianceService.generateSlotsForDate(date);
  }

  @Post('generate-today')
  generateToday(): Promise<GenerateSlotsResult> {
    return this.complianceService.generateToday();
  }
}
