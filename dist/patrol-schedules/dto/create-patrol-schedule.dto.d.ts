export declare class CreatePatrolScheduleDto {
    siteId: string;
    frequencyMinutes: number;
    startHour: number;
    endHour: number;
    graceMinutes: number;
    activeDays: number[];
    active?: boolean;
}
