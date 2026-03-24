import { Site } from '@/sites/entities/site.entity';
import { PatrolSlot } from '@/patrol-slots/entities/patrol-slot.entity';
export declare class PatrolAlert {
    id: string;
    siteId: string;
    site: Site;
    slotId: string;
    slot: PatrolSlot;
    alertType: string;
    alertMessage: string;
    alertTime: Date;
    isResolved: boolean;
    resolvedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}
