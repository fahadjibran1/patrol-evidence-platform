import { Site } from '@/sites/entities/site.entity';
import { PatrolSlotStatus } from '@/common/enums/patrol-slot-status.enum';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';
export declare class PatrolSlot {
    id: string;
    siteId: string;
    site: Site;
    slotStart: Date;
    slotEnd: Date;
    expectedAt: Date;
    status: PatrolSlotStatus;
    imageId: string | null;
    image: PatrolImage | null;
    resolvedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}
