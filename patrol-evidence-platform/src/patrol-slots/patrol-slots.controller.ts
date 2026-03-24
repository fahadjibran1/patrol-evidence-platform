import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { PatrolSlotsService } from './patrol-slots.service';
import { PatrolSlot } from './entities/patrol-slot.entity';

@Controller('patrol-slots')
export class PatrolSlotsController {
  constructor(private readonly patrolSlotsService: PatrolSlotsService) {}

  @Get()
  async findBySiteAndDate(
    @Query('siteCode') siteCode: string,
    @Query('date') date: string,
  ): Promise<PatrolSlot[]> {
    if (!siteCode || !date) {
      throw new BadRequestException('siteCode and date query params are required');
    }

    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);
    return this.patrolSlotsService.findBySiteCodeAndDate(siteCode, dayStart, dayEnd);
  }
}
