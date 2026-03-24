import { Repository } from 'typeorm';
import { PatrolSlot } from './entities/patrol-slot.entity';
import { PatrolSlotStatus } from '@/common/enums/patrol-slot-status.enum';
export declare class PatrolSlotsService {
    private readonly slotsRepo;
    constructor(slotsRepo: Repository<PatrolSlot>);
    createMany(slots: Partial<PatrolSlot>[]): Promise<PatrolSlot[]>;
    findBySiteAndDate(siteId: string, dayStart: Date, dayEnd: Date): Promise<PatrolSlot[]>;
    findBySiteCodeAndDate(siteCode: string, dayStart: Date, dayEnd: Date): Promise<PatrolSlot[]>;
    findSlotForTimestamp(siteId: string, timestamp: Date): Promise<PatrolSlot | null>;
    updateSlotStatus(slotId: string, status: PatrolSlotStatus, imageId?: string): Promise<PatrolSlot>;
    save(slot: PatrolSlot): Promise<PatrolSlot>;
    findPendingPastCutoff(now: Date): Promise<PatrolSlot[]>;
}
