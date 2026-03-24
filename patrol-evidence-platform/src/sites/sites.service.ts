import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Site } from './entities/site.entity';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';

@Injectable()
export class SitesService {
  constructor(@InjectRepository(Site) private readonly sitesRepo: Repository<Site>) {}

  create(dto: CreateSiteDto): Promise<Site> {
    return this.sitesRepo.save(this.sitesRepo.create(dto));
  }

  findAll(): Promise<Site[]> {
    return this.sitesRepo.find({ order: { siteCode: 'ASC' } });
  }

  async findOne(id: string): Promise<Site> {
    const site = await this.sitesRepo.findOne({ where: { id } });
    if (!site) {
      throw new NotFoundException(`Site ${id} not found`);
    }
    return site;
  }

  async update(id: string, dto: UpdateSiteDto): Promise<Site> {
    const site = await this.findOne(id);
    return this.sitesRepo.save({ ...site, ...dto });
  }

  async remove(id: string): Promise<void> {
    const site = await this.findOne(id);
    await this.sitesRepo.remove(site);
  }
}
