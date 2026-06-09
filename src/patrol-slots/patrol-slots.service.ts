import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { PatrolSlot } from './entities/patrol-slot.entity';
import { PatrolSlotStatus } from '@/common/enums/patrol-slot-status.enum';
import { AuthenticatedUser } from '@/auth/interfaces/authenticated-request.interface';
import { UserRole } from '@/common/enums/user-role.enum';

@Injectable()
export class PatrolSlotsService {
  constructor(
    @InjectRepository(PatrolSlot)
    private readonly slotsRepo: Repository<PatrolSlot>,
  ) {}

  createMany(slots: Partial<PatrolSlot>[]): Promise<PatrolSlot[]> {
    return this.slotsRepo.save(this.slotsRepo.create(slots));
  }

  findBySiteAndDate(siteId: string, dayStart: Date, dayEnd: Date): Promise<PatrolSlot[]> {
    return this.slotsRepo.find({
      where: {
        siteId,
        expectedAt: Between(dayStart, dayEnd),
      },
      order: { expectedAt: 'ASC' },
    });
  }

  async findBySiteCodeAndDate(
    siteCode: string,
    dayStart: Date,
    dayEnd: Date,
    user: AuthenticatedUser,
  ): Promise<PatrolSlot[]> {
    const query = this.slotsRepo
      .createQueryBuilder('slot')
      .innerJoinAndSelect('slot.site', 'site')
      .where('site.siteCode = :siteCode', { siteCode })
      .andWhere('slot.expectedAt BETWEEN :dayStart AND :dayEnd', { dayStart, dayEnd })
      .orderBy('slot.expectedAt', 'ASC');

    if (user.role !== UserRole.ADMIN) {
      query.andWhere('site.companyId = :companyId', { companyId: user.companyId });
    }

    return query.getMany();
  }

  async findSlotForTimestamp(siteId: string, timestamp: Date): Promise<PatrolSlot | null> {
    return this.slotsRepo
      .createQueryBuilder('slot')
      .where('slot.siteId = :siteId', { siteId })
      .andWhere(':timestamp >= slot.slotStart', { timestamp })
      .andWhere(':timestamp < slot.slotEnd', { timestamp })
      .orderBy('slot.slotStart', 'DESC')
      .getOne();
  }

  async updateSlotStatus(slotId: string, status: PatrolSlotStatus, imageId?: string): Promise<PatrolSlot> {
    const slot = await this.slotsRepo.findOne({ where: { id: slotId } });
    if (!slot) {
      throw new NotFoundException(`Slot ${slotId} not found`);
    }

    slot.status = status;
    slot.imageId = imageId ?? null;
    slot.resolvedAt = new Date();
    return this.slotsRepo.save(slot);
  }

  async save(slot: PatrolSlot): Promise<PatrolSlot> {
    return this.slotsRepo.save(slot);
  }

  async findPendingPastCutoff(now: Date): Promise<PatrolSlot[]> {
    return this.slotsRepo
      .createQueryBuilder('slot')
      .where('slot.status = :status', { status: PatrolSlotStatus.PENDING })
      .andWhere('slot.slotEnd < :now', { now })
      .getMany();
  }
}
