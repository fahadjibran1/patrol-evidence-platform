import { Repository } from 'typeorm';
import { PatrolGroup } from './entities/patrol-group.entity';
import { CreatePatrolGroupDto } from './dto/create-patrol-group.dto';
import { UpdatePatrolGroupDto } from './dto/update-patrol-group.dto';
import { SitesService } from '@/sites/sites.service';
export declare class PatrolGroupsService {
    private readonly groupsRepo;
    private readonly sitesService;
    constructor(groupsRepo: Repository<PatrolGroup>, sitesService: SitesService);
    create(dto: CreatePatrolGroupDto): Promise<PatrolGroup>;
    findAll(): Promise<PatrolGroup[]>;
    findOne(id: string): Promise<PatrolGroup>;
    update(id: string, dto: UpdatePatrolGroupDto): Promise<PatrolGroup>;
    remove(id: string): Promise<void>;
}
