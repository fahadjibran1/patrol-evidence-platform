import { PatrolSlotsService } from './patrol-slots.service';
import { PatrolSlot } from './entities/patrol-slot.entity';
export declare class PatrolSlotsController {
    private readonly patrolSlotsService;
    constructor(patrolSlotsService: PatrolSlotsService);
    findBySiteAndDate(siteCode: string, date: string): Promise<PatrolSlot[]>;
}
