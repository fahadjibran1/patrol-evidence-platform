import { SitesService } from './sites.service';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';
import { Site } from './entities/site.entity';
export declare class SitesController {
    private readonly sitesService;
    constructor(sitesService: SitesService);
    create(dto: CreateSiteDto): Promise<Site>;
    findAll(): Promise<Site[]>;
    findOne(id: string): Promise<Site>;
    update(id: string, dto: UpdateSiteDto): Promise<Site>;
    remove(id: string): Promise<void>;
}
