import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Site } from '@/sites/entities/site.entity';
import { PatrolSlot } from '@/patrol-slots/entities/patrol-slot.entity';
import { PatrolAlert } from '@/patrol-alerts/entities/patrol-alert.entity';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';
import { PatrolSlotStatus } from '@/common/enums/patrol-slot-status.enum';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
    @InjectRepository(PatrolSlot)
    private readonly slotRepo: Repository<PatrolSlot>,
    @InjectRepository(PatrolAlert)
    private readonly alertRepo: Repository<PatrolAlert>,
    @InjectRepository(PatrolImage)
    private readonly imageRepo: Repository<PatrolImage>,
  ) {}

  async getLiveSites(): Promise<
    Array<{
      siteName: string;
      siteCode: string;
      latestPatrolAt: Date | null;
      currentStatus: PatrolSlotStatus | 'NO_DATA';
      nextPatrolDue: Date | null;
      todayCompliancePercent: number;
      missingCountToday: number;
      lateCountToday: number;
    }>
  > {
    const sites = await this.siteRepo.find({ where: { active: true }, order: { siteCode: 'ASC' } });
    const today = new Date().toISOString().slice(0, 10);
    const dayStart = new Date(`${today}T00:00:00.000Z`);
    const dayEnd = new Date(`${today}T23:59:59.999Z`);

    return Promise.all(
      sites.map(async (site) => {
        const [latestImage, latestSlot, nextPending, slots] = await Promise.all([
          this.imageRepo.findOne({ where: { siteId: site.id }, order: { sentAt: 'DESC' } }),
          this.slotRepo.findOne({ where: { siteId: site.id }, order: { expectedAt: 'DESC' } }),
          this.slotRepo
            .createQueryBuilder('slot')
            .where('slot.siteId = :siteId', { siteId: site.id })
            .andWhere('slot.expectedAt >= :now', { now: new Date() })
            .orderBy('slot.expectedAt', 'ASC')
            .getOne(),
          this.slotRepo
            .createQueryBuilder('slot')
            .where('slot.siteId = :siteId', { siteId: site.id })
            .andWhere('slot.expectedAt BETWEEN :dayStart AND :dayEnd', { dayStart, dayEnd })
            .getMany(),
        ]);

        const expected = slots.length;
        const onTimeOrLate = slots.filter((slot) =>
          [PatrolSlotStatus.RECEIVED_ON_TIME, PatrolSlotStatus.RECEIVED_LATE].includes(slot.status),
        ).length;

        const missingCountToday = slots.filter((slot) => slot.status === PatrolSlotStatus.MISSING).length;
        const lateCountToday = slots.filter((slot) => slot.status === PatrolSlotStatus.RECEIVED_LATE).length;

        return {
          siteName: site.siteName,
          siteCode: site.siteCode,
          latestPatrolAt: latestImage?.sentAt ?? null,
          currentStatus: latestSlot?.status ?? 'NO_DATA',
          nextPatrolDue: nextPending?.expectedAt ?? null,
          todayCompliancePercent: expected > 0 ? Number(((onTimeOrLate / expected) * 100).toFixed(2)) : 0,
          missingCountToday,
          lateCountToday,
        };
      }),
    );
  }

  async getMissingPatrols(): Promise<
    Array<{
      siteCode: string;
      siteName: string;
      expectedAt: Date;
      latenessMinutes: number;
      alertStatus: 'OPEN' | 'RESOLVED';
    }>
  > {
    const alerts = await this.alertRepo.find({
      where: { alertType: 'MISSING_PATROL' },
      relations: ['site', 'slot'],
      order: { alertTime: 'DESC' },
    });

    return alerts.map((alert) => ({
      siteCode: alert.site.siteCode,
      siteName: alert.site.siteName,
      expectedAt: alert.slot.expectedAt,
      latenessMinutes: Math.max(0, Math.floor((Date.now() - alert.slot.expectedAt.getTime()) / 60000)),
      alertStatus: alert.isResolved ? 'RESOLVED' : 'OPEN',
    }));
  }

  async getDailyReport(siteCode: string, date: string): Promise<{
    siteCode: string;
    date: string;
    expectedPatrolCount: number;
    onTimeCount: number;
    lateCount: number;
    missingCount: number;
    duplicateCount: number;
    compliancePercentage: number;
  }> {
    const site = await this.siteRepo.findOneOrFail({ where: { siteCode } });
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);

    const [slots, duplicates] = await Promise.all([
      this.slotRepo
        .createQueryBuilder('slot')
        .where('slot.siteId = :siteId', { siteId: site.id })
        .andWhere('slot.expectedAt BETWEEN :dayStart AND :dayEnd', { dayStart, dayEnd })
        .getMany(),
      this.imageRepo
        .createQueryBuilder('image')
        .where('image.siteId = :siteId', { siteId: site.id })
        .andWhere('image.patrolDate = :date', { date })
        .andWhere('image.status = :status', { status: PatrolSlotStatus.DUPLICATE })
        .getCount(),
    ]);

    const expectedPatrolCount = slots.length;
    const onTimeCount = slots.filter((slot) => slot.status === PatrolSlotStatus.RECEIVED_ON_TIME).length;
    const lateCount = slots.filter((slot) => slot.status === PatrolSlotStatus.RECEIVED_LATE).length;
    const missingCount = slots.filter((slot) => slot.status === PatrolSlotStatus.MISSING).length;

    const compliancePercentage =
      expectedPatrolCount > 0
        ? Number((((onTimeCount + lateCount) / expectedPatrolCount) * 100).toFixed(2))
        : 0;

    return {
      siteCode,
      date,
      expectedPatrolCount,
      onTimeCount,
      lateCount,
      missingCount,
      duplicateCount: duplicates,
      compliancePercentage,
    };
  }
}
