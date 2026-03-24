import { Repository } from 'typeorm';
import { PatrolSchedule } from './entities/patrol-schedule.entity';
import { CreatePatrolScheduleDto } from './dto/create-patrol-schedule.dto';
import { UpdatePatrolScheduleDto } from './dto/update-patrol-schedule.dto';
import { SitesService } from '@/sites/sites.service';
export declare class PatrolSchedulesService {
    private readonly schedulesRepo;
    private readonly sitesService;
    constructor(schedulesRepo: Repository<PatrolSchedule>, sitesService: SitesService);
    create(dto: CreatePatrolScheduleDto): Promise<PatrolSchedule>;
    findAll(): Promise<PatrolSchedule[]>;
    findOne(id: string): Promise<PatrolSchedule>;
    update(id: string, dto: UpdatePatrolScheduleDto): Promise<PatrolSchedule>;
    remove(id: string): Promise<void>;
    private validateHours;
}
