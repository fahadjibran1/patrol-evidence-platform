import { PatrolGroup } from '@/patrol-groups/entities/patrol-group.entity';
import { PatrolSchedule } from '@/patrol-schedules/entities/patrol-schedule.entity';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';
import { PatrolSlot } from '@/patrol-slots/entities/patrol-slot.entity';
import { PatrolAlert } from '@/patrol-alerts/entities/patrol-alert.entity';
export declare class Site {
    id: string;
    siteCode: string;
    siteName: string;
    clientName: string | null;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
    groups: PatrolGroup[];
    schedules: PatrolSchedule[];
    images: PatrolImage[];
    slots: PatrolSlot[];
    alerts: PatrolAlert[];
}
