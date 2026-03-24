import { Repository } from 'typeorm';
import { PatrolImage } from './entities/patrol-image.entity';
import { CreatePatrolImageDto } from './dto/create-patrol-image.dto';
import { ComplianceService } from '@/compliance/compliance.service';
export declare class PatrolImagesService {
    private readonly imageRepo;
    private readonly complianceService;
    constructor(imageRepo: Repository<PatrolImage>, complianceService: ComplianceService);
    create(dto: CreatePatrolImageDto): Promise<PatrolImage>;
}
