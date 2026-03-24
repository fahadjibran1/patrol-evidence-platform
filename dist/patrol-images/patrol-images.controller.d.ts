import { PatrolImagesService } from './patrol-images.service';
import { CreatePatrolImageDto } from './dto/create-patrol-image.dto';
import { PatrolImage } from './entities/patrol-image.entity';
import { ManualIngestDto } from './dto/manual-ingest.dto';
import { PatrolImageIngestionService } from './patrol-image-ingestion.service';
export declare class PatrolImagesController {
    private readonly patrolImagesService;
    private readonly patrolImageIngestionService;
    constructor(patrolImagesService: PatrolImagesService, patrolImageIngestionService: PatrolImageIngestionService);
    create(dto: CreatePatrolImageDto): Promise<PatrolImage>;
    manualIngest(dto: ManualIngestDto, file: Express.Multer.File): Promise<PatrolImage>;
}
