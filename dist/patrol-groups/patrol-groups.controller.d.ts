import { PatrolGroupsService } from './patrol-groups.service';
import { CreatePatrolGroupDto } from './dto/create-patrol-group.dto';
import { UpdatePatrolGroupDto } from './dto/update-patrol-group.dto';
import { PatrolGroup } from './entities/patrol-group.entity';
export declare class PatrolGroupsController {
    private readonly groupsService;
    constructor(groupsService: PatrolGroupsService);
    create(dto: CreatePatrolGroupDto): Promise<PatrolGroup>;
    findAll(): Promise<PatrolGroup[]>;
    findOne(id: string): Promise<PatrolGroup>;
    update(id: string, dto: UpdatePatrolGroupDto): Promise<PatrolGroup>;
    remove(id: string): Promise<void>;
}
