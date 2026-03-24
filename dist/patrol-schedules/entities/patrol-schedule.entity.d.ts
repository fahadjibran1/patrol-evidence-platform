import { Site } from '@/sites/entities/site.entity';
export declare class PatrolSchedule {
    id: string;
    siteId: string;
    site: Site;
    frequencyMinutes: number;
    startHour: number;
    endHour: number;
    graceMinutes: number;
    activeDays: number[];
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
}
