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
import { getPatrolTimeParts } from '@/common/utils/patrol-time.util';
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
    const dayStart = new Date(`${normalizedDate}T00:00:00.000Z`);
    const dayEnd = new Date(`${normalizedDate}T23:59:59.999Z`);

    if (!normalizedDate || Number.isNaN(dayStart.getTime()) || Number.isNaN(dayEnd.getTime())) {
      throw new BadRequestException('date must use YYYY-MM-DD format');
    }

    const activeSites = await this.siteRepo.find({
      where: user && user.role !== UserRole.ADMIN ? { active: true, companyId: user.companyId ?? undefined } : { active: true },
    });
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

      const existing = await this.patrolSlotsService.findBySiteAndDate(site.id, dayStart, dayEnd);
      const existingExpectedTimes = new Set(existing.map((slot) => slot.expectedAt.toISOString()));
      const slots: Partial<PatrolSlot>[] = [];

      for (const schedule of activeSchedules) {
        const frequency = schedule.frequencyMinutes;

        for (const hour of enumerateScheduleHours(schedule.startHour, schedule.endHour)) {
          const slotStart = new Date(
            Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth(), dayStart.getUTCDate(), hour, 0, 0),
          );

          for (let minute = 0; minute < 60; minute += frequency) {
            const expectedAt = new Date(slotStart.getTime() + minute * 60 * 1000);
            const slotEnd = new Date(expectedAt.getTime() + frequency * 60 * 1000);

            if (expectedAt > dayEnd) {
              continue;
            }

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
    const date = new Date().toISOString().slice(0, 10);
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
