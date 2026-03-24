import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PatrolSchedule } from './entities/patrol-schedule.entity';
import { CreatePatrolScheduleDto } from './dto/create-patrol-schedule.dto';
import { UpdatePatrolScheduleDto } from './dto/update-patrol-schedule.dto';
import { SitesService } from '@/sites/sites.service';

@Injectable()
export class PatrolSchedulesService {
  constructor(
    @InjectRepository(PatrolSchedule) private readonly schedulesRepo: Repository<PatrolSchedule>,
    private readonly sitesService: SitesService,
  ) {}

  async create(dto: CreatePatrolScheduleDto): Promise<PatrolSchedule> {
    this.validateHours(dto.startHour, dto.endHour);
    await this.sitesService.findOne(dto.siteId);
    return this.schedulesRepo.save(this.schedulesRepo.create(dto));
  }

  findAll(): Promise<PatrolSchedule[]> {
    return this.schedulesRepo.find({ relations: ['site'], order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<PatrolSchedule> {
    const schedule = await this.schedulesRepo.findOne({ where: { id }, relations: ['site'] });
    if (!schedule) {
      throw new NotFoundException(`Patrol schedule ${id} not found`);
    }
    return schedule;
  }

  async update(id: string, dto: UpdatePatrolScheduleDto): Promise<PatrolSchedule> {
    const schedule = await this.findOne(id);
    if (dto.siteId) {
      await this.sitesService.findOne(dto.siteId);
    }
    this.validateHours(dto.startHour ?? schedule.startHour, dto.endHour ?? schedule.endHour);
    return this.schedulesRepo.save({ ...schedule, ...dto });
  }

  async remove(id: string): Promise<void> {
    const schedule = await this.findOne(id);
    await this.schedulesRepo.remove(schedule);
  }

  private validateHours(startHour: number, endHour: number): void {
    if (endHour < startHour) {
      throw new BadRequestException('endHour must be greater than or equal to startHour');
    }
  }
}
