import { Repository } from 'typeorm';
import { Site } from './entities/site.entity';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';
export declare class SitesService {
    private readonly sitesRepo;
    constructor(sitesRepo: Repository<Site>);
    create(dto: CreateSiteDto): Promise<Site>;
    findAll(): Promise<Site[]>;
    findOne(id: string): Promise<Site>;
    update(id: string, dto: UpdateSiteDto): Promise<Site>;
    remove(id: string): Promise<void>;
}
