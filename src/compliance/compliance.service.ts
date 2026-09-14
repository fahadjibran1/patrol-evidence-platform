import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Site } from '@/sites/entities/site.entity';
import { PatrolSchedule } from '@/patrol-schedules/entities/patrol-schedule.entity';
import { PatrolSlotsService } from '@/patrol-slots/patrol-slots.service';
import { PatrolSlotStatus } from '@/common/enums/patrol-slot-status.enum';
import { PatrolSlot } from '@/patrol-slots/entities/patrol-slot.entity';
import { PatrolAlertsService } from '@/patrol-alerts/patrol-alerts.service';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';
import { enumerateScheduleHours, scheduleIsActiveOnDate } from '@/common/utils/patrol-schedule.util';
import {
  addOperationalCalendarDays,
  getOperationalDateUtcBounds,
  getPatrolTimeParts,
  operationalDateTimeToUtc,
} from '@/common/utils/patrol-time.util';
import { AuthenticatedUser } from '@/auth/interfaces/authenticated-request.interface';
import { UserRole } from '@/common/enums/user-role.enum';

export interface GenerateSlotsResult {
  slotsCreated: number;
  sitesProcessed: number;
}

@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
    @InjectRepository(PatrolSchedule)
    private readonly schedulesRepo: Repository<PatrolSchedule>,
    private readonly patrolSlotsService: PatrolSlotsService,
    private readonly patrolAlertsService: PatrolAlertsService,
  ) {}

  async generateSlotsForDate(date: string, user?: AuthenticatedUser): Promise<GenerateSlotsResult> {
    const normalizedDate = date?.trim();
    let dayStart: Date;
    let nextDayStart: Date;
    try {
      if (!normalizedDate) throw new Error('missing');
      const bounds = getOperationalDateUtcBounds(normalizedDate);
      dayStart = bounds.startInclusive;
      nextDayStart = bounds.endExclusive;
    } catch {
      throw new BadRequestException('date must use YYYY-MM-DD format');
    }

    const activeSites = await this.siteRepo
      .createQueryBuilder('site')
      .where('site.active = :active', { active: true })
      .andWhere('site.archivedAt IS NULL')
      .andWhere(user && user.role !== UserRole.ADMIN ? 'site.companyId = :companyId' : '1=1', {
        companyId: user?.companyId,
      })
      .getMany();
    let slotsCreated = 0;
    let sitesProcessed = 0;

    for (const site of activeSites) {
      const schedules = await this.schedulesRepo.find({
        where: { siteId: site.id, active: true },
        order: { createdAt: 'DESC' },
      });

      const activeSchedules = schedules.filter((schedule) =>
        scheduleIsActiveOnDate(schedule, normalizedDate),
      );

      if (activeSchedules.length === 0) {
        continue;
      }

      sitesProcessed += 1;

      const hasOvernightSchedule = activeSchedules.some(
        (schedule) => !schedule.is24Hours && schedule.startHour > schedule.endHour,
      );
      const existingEndExclusive = hasOvernightSchedule
        ? getOperationalDateUtcBounds(addOperationalCalendarDays(normalizedDate, 1)).endExclusive
        : nextDayStart;
      const existing = await this.patrolSlotsService.findBySiteAndDate(
        site.id,
        dayStart,
        new Date(existingEndExclusive.getTime() - 1),
      );
      const existingExpectedTimes = new Set(existing.map((slot) => slot.expectedAt.toISOString()));
      const slots: Partial<PatrolSlot>[] = [];

      for (const schedule of activeSchedules) {
        const frequency = schedule.frequencyMinutes;

        for (const hour of enumerateScheduleHours(schedule.startHour, schedule.endHour, Boolean(schedule.is24Hours))) {
          const slotDate =
            !schedule.is24Hours && schedule.startHour > schedule.endHour && hour < schedule.endHour
              ? addOperationalCalendarDays(normalizedDate, 1)
              : normalizedDate;

          for (let minute = 0; minute < 60; minute += frequency) {
            const expectedAt = operationalDateTimeToUtc({ date: slotDate, hour, minute });
            const slotEnd = new Date(expectedAt.getTime() + frequency * 60 * 1000);

            if (existingExpectedTimes.has(expectedAt.toISOString())) {
              continue;
            }

            existingExpectedTimes.add(expectedAt.toISOString());
            slots.push({
              siteId: site.id,
              expectedAt,
              slotStart: expectedAt,
              slotEnd,
              status: PatrolSlotStatus.PENDING,
            });
          }
        }
      }

      if (slots.length > 0) {
        await this.patrolSlotsService.createMany(slots);
        slotsCreated += slots.length;
      }
    }

    return { slotsCreated, sitesProcessed };
  }

  async generateToday(user?: AuthenticatedUser): Promise<GenerateSlotsResult> {
    const date = getPatrolTimeParts(new Date()).date;
    return this.generateSlotsForDate(date, user);
  }

  async updateSlotStatusFromImage(image: PatrolImage): Promise<PatrolSlotStatus> {
    const schedule = await this.schedulesRepo.findOne({
      where: { siteId: image.siteId, active: true },
      order: { createdAt: 'DESC' },
    });

    if (!schedule) {
      return PatrolSlotStatus.RECEIVED_ON_TIME;
    }

    let slot = await this.patrolSlotsService.findSlotForTimestamp(image.siteId, image.sentAt);
    if (!slot) {
      await this.generateSlotsForDate(this.toDateKey(image.sentAt));
      slot = await this.patrolSlotsService.findSlotForTimestamp(image.siteId, image.sentAt);
    }

    if (!slot) {
      return PatrolSlotStatus.RECEIVED_ON_TIME;
    }

    if (slot.imageId) {
      return slot.status === PatrolSlotStatus.RECEIVED_LATE
        ? PatrolSlotStatus.RECEIVED_LATE
        : PatrolSlotStatus.RECEIVED_ON_TIME;
    }

    const graceMinutes = schedule?.graceMinutes ?? 15;
    const graceCutoff = new Date(slot.expectedAt.getTime() + graceMinutes * 60 * 1000);
    const status = image.sentAt <= graceCutoff ? PatrolSlotStatus.RECEIVED_ON_TIME : PatrolSlotStatus.RECEIVED_LATE;

    await this.patrolSlotsService.updateSlotStatus(slot.id, status, image.id);
    return status;
  }

  async markMissingSlots(now: Date = new Date()): Promise<number> {
    const stalePending = await this.patrolSlotsService.findPendingPastCutoff(now);
    let missingCount = 0;

    for (const slot of stalePending) {
      const schedule = await this.schedulesRepo.findOne({
        where: { siteId: slot.siteId, active: true },
        order: { createdAt: 'DESC' },
      });
      const graceMinutes = schedule?.graceMinutes ?? 15;
      const missingCutoff = new Date(slot.slotEnd.getTime() + graceMinutes * 60 * 1000);

      if (now <= missingCutoff) {
        continue;
      }

      await this.patrolSlotsService.updateSlotStatus(slot.id, PatrolSlotStatus.MISSING);
      await this.patrolAlertsService.createMissingAlert({
        siteId: slot.siteId,
        slotId: slot.id,
        alertTime: now,
        alertMessage: `Missing patrol evidence for expected slot ${slot.expectedAt.toISOString()}`,
      });
      missingCount += 1;
    }

    return missingCount;
  }

  @Cron('*/5 * * * *')
  async checkMissingPatrols(): Promise<void> {
    const marked = await this.markMissingSlots();
    if (marked > 0) {
      this.logger.warn(`Marked ${marked} slot(s) as missing.`);
    }
  }

  private toDateKey(date: Date): string {
    return getPatrolTimeParts(date).date;
  }
}
