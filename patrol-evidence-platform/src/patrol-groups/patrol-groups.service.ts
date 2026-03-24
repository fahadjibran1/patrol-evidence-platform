import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PatrolGroup } from './entities/patrol-group.entity';
import { CreatePatrolGroupDto } from './dto/create-patrol-group.dto';
import { UpdatePatrolGroupDto } from './dto/update-patrol-group.dto';
import { SitesService } from '@/sites/sites.service';

@Injectable()
export class PatrolGroupsService {
  constructor(
    @InjectRepository(PatrolGroup) private readonly groupsRepo: Repository<PatrolGroup>,
    private readonly sitesService: SitesService,
  ) {}

  async create(dto: CreatePatrolGroupDto): Promise<PatrolGroup> {
    await this.sitesService.findOne(dto.siteId);
    return this.groupsRepo.save(this.groupsRepo.create(dto));
  }

  findAll(): Promise<PatrolGroup[]> {
    return this.groupsRepo.find({ relations: ['site'], order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<PatrolGroup> {
    const group = await this.groupsRepo.findOne({ where: { id }, relations: ['site'] });
    if (!group) {
      throw new NotFoundException(`Patrol group ${id} not found`);
    }
    return group;
  }

  async update(id: string, dto: UpdatePatrolGroupDto): Promise<PatrolGroup> {
    if (dto.siteId) {
      await this.sitesService.findOne(dto.siteId);
    }
    const group = await this.findOne(id);
    return this.groupsRepo.save({ ...group, ...dto });
  }

  async remove(id: string): Promise<void> {
    const group = await this.findOne(id);
    await this.groupsRepo.remove(group);
  }
}
