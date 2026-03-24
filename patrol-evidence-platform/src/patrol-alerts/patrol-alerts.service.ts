import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PatrolAlert } from './entities/patrol-alert.entity';

@Injectable()
export class PatrolAlertsService {
  constructor(
    @InjectRepository(PatrolAlert)
    private readonly alertsRepo: Repository<PatrolAlert>,
  ) {}

  async createMissingAlert(params: {
    siteId: string;
    slotId: string;
    alertTime: Date;
    alertMessage: string;
  }): Promise<PatrolAlert> {
    const existing = await this.alertsRepo.findOne({
      where: {
        siteId: params.siteId,
        slotId: params.slotId,
        alertType: 'MISSING_PATROL',
      },
    });

    if (existing) {
      return existing;
    }

    return this.alertsRepo.save(
      this.alertsRepo.create({
        siteId: params.siteId,
        slotId: params.slotId,
        alertType: 'MISSING_PATROL',
        alertTime: params.alertTime,
        alertMessage: params.alertMessage,
        isResolved: false,
      }),
    );
  }
}
