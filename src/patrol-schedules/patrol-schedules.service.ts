import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PatrolSchedule } from './entities/patrol-schedule.entity';
import { CreatePatrolScheduleDto } from './dto/create-patrol-schedule.dto';
import { UpdatePatrolScheduleDto } from './dto/update-patrol-schedule.dto';
import { SitesService } from '@/sites/sites.service';
import { AuthenticatedUser } from '@/auth/interfaces/authenticated-request.interface';
import { UserRole } from '@/common/enums/user-role.enum';

@Injectable()
export class PatrolSchedulesService {
  constructor(
    @InjectRepository(PatrolSchedule) private readonly schedulesRepo: Repository<PatrolSchedule>,
    private readonly sitesService: SitesService,
  ) {}

  async create(dto: CreatePatrolScheduleDto, user: AuthenticatedUser): Promise<PatrolSchedule> {
    await this.sitesService.findOne(dto.siteId, user);
    return this.schedulesRepo.save(
      this.schedulesRepo.create({
        ...dto,
        scheduleName: dto.scheduleName?.trim() || 'Shift',
        expectedGuards: dto.expectedGuards ?? 1,
      }),
    );
  }

  async findAll(user: AuthenticatedUser): Promise<PatrolSchedule[]> {
    const query = this.schedulesRepo
      .createQueryBuilder('schedule')
      .leftJoinAndSelect('schedule.site', 'site')
      .leftJoinAndSelect('site.company', 'company')
      .orderBy('schedule.createdAt', 'DESC');

    if (user.role !== UserRole.ADMIN) {
      query.where('site.companyId = :companyId', { companyId: user.companyId });
    }

    return query.getMany();
  }

  async findOne(id: string, user: AuthenticatedUser): Promise<PatrolSchedule> {
    const query = this.schedulesRepo
      .createQueryBuilder('schedule')
      .leftJoinAndSelect('schedule.site', 'site')
      .leftJoinAndSelect('site.company', 'company')
      .where('schedule.id = :id', { id });

    if (user.role !== UserRole.ADMIN) {
      query.andWhere('site.companyId = :companyId', { companyId: user.companyId });
    }

    const schedule = await query.getOne();
    if (!schedule) {
      throw new NotFoundException(`Patrol schedule ${id} not found`);
    }
    return schedule;
  }

  async update(id: string, dto: UpdatePatrolScheduleDto, user: AuthenticatedUser): Promise<PatrolSchedule> {
    const schedule = await this.findOne(id, user);
    if (dto.siteId) {
      await this.sitesService.findOne(dto.siteId, user);
    }

    const nextScheduleName =
      dto.scheduleName !== undefined ? dto.scheduleName.trim() || 'Shift' : schedule.scheduleName;

    return this.schedulesRepo.save({
      ...schedule,
      ...dto,
      scheduleName: nextScheduleName,
    });
  }

  async remove(id: string, user: AuthenticatedUser): Promise<void> {
    const schedule = await this.findOne(id, user);
    await this.schedulesRepo.remove(schedule);
  }
}
