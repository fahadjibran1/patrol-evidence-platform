import { Repository } from 'typeorm';
import { Site } from '@/sites/entities/site.entity';
import { PatrolSchedule } from '@/patrol-schedules/entities/patrol-schedule.entity';
import { PatrolSlotsService } from '@/patrol-slots/patrol-slots.service';
import { PatrolSlotStatus } from '@/common/enums/patrol-slot-status.enum';
import { PatrolAlertsService } from '@/patrol-alerts/patrol-alerts.service';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';
export interface GenerateSlotsResult {
    slotsCreated: number;
    sitesProcessed: number;
}
export declare class ComplianceService {
    private readonly siteRepo;
    private readonly schedulesRepo;
    private readonly patrolSlotsService;
    private readonly patrolAlertsService;
    private readonly logger;
    constructor(siteRepo: Repository<Site>, schedulesRepo: Repository<PatrolSchedule>, patrolSlotsService: PatrolSlotsService, patrolAlertsService: PatrolAlertsService);
    generateSlotsForDate(date: string): Promise<GenerateSlotsResult>;
    generateToday(): Promise<GenerateSlotsResult>;
    updateSlotStatusFromImage(image: PatrolImage): Promise<PatrolSlotStatus>;
    markMissingSlots(now?: Date): Promise<number>;
    checkMissingPatrols(): Promise<void>;
}
