import { PatrolSchedulesService } from './patrol-schedules.service';
import { CreatePatrolScheduleDto } from './dto/create-patrol-schedule.dto';
import { UpdatePatrolScheduleDto } from './dto/update-patrol-schedule.dto';
import { PatrolSchedule } from './entities/patrol-schedule.entity';
export declare class PatrolSchedulesController {
    private readonly schedulesService;
    constructor(schedulesService: PatrolSchedulesService);
    create(dto: CreatePatrolScheduleDto): Promise<PatrolSchedule>;
    findAll(): Promise<PatrolSchedule[]>;
    findOne(id: string): Promise<PatrolSchedule>;
    update(id: string, dto: UpdatePatrolScheduleDto): Promise<PatrolSchedule>;
    remove(id: string): Promise<void>;
}
