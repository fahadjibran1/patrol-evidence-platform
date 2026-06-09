import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Incident } from './entities/incident.entity';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { UpdateIncidentStatusDto } from './dto/update-incident-status.dto';
import { AuthenticatedUser } from '@/auth/interfaces/authenticated-request.interface';
import { UserRole } from '@/common/enums/user-role.enum';
import { IncidentStatus } from '@/common/enums/incident-status.enum';
import { SitesService } from '@/sites/sites.service';

@Injectable()
export class IncidentsService {
  constructor(
    @InjectRepository(Incident)
    private readonly incidentsRepo: Repository<Incident>,
    private readonly sitesService: SitesService,
  ) {}

  async create(dto: CreateIncidentDto, user: AuthenticatedUser): Promise<Incident> {
    if (user.role === UserRole.GUARD && !user.companyId) {
      throw new ForbiddenException('Guard is not assigned to a company');
    }

    const site = await this.sitesService.findActiveById(dto.siteId, user);
    const guardId = user.role === UserRole.GUARD ? user.sub : user.sub;
    const companyId = user.role === UserRole.ADMIN ? site.companyId : (user.companyId ?? site.companyId);

    return this.incidentsRepo.save(
      this.incidentsRepo.create({
        guardId,
        companyId,
        siteId: site.id,
        description: dto.description.trim(),
        severity: dto.severity,
        status: IncidentStatus.OPEN,
      }),
    );
  }

  async findAll(user: AuthenticatedUser): Promise<Incident[]> {
    const query = this.incidentsRepo
      .createQueryBuilder('incident')
      .leftJoinAndSelect('incident.site', 'site')
      .leftJoinAndSelect('incident.guard', 'guard')
      .leftJoinAndSelect('incident.company', 'company')
      .orderBy('incident.createdAt', 'DESC');

    if (user.role === UserRole.ADMIN) {
      return query.getMany();
    }

    if (user.role === UserRole.COMPANY_ADMIN) {
      query.where('incident.companyId = :companyId', { companyId: user.companyId });
      return query.getMany();
    }

    query.where('incident.guardId = :guardId', { guardId: user.sub });
    return query.getMany();
  }

  async findOne(id: string, user: AuthenticatedUser): Promise<Incident> {
    const incident = await this.incidentsRepo.findOne({
      where: { id },
      relations: ['site', 'guard', 'company'],
    });

    if (!incident) {
      throw new NotFoundException(`Incident ${id} not found`);
    }

    this.assertAccess(user, incident);
    return incident;
  }

  async updateStatus(id: string, dto: UpdateIncidentStatusDto, user: AuthenticatedUser): Promise<Incident> {
    if (user.role === UserRole.GUARD) {
      throw new ForbiddenException('Guards cannot change incident status');
    }

    const incident = await this.findOne(id, user);
    incident.status = dto.status;
    return this.incidentsRepo.save(incident);
  }

  private assertAccess(user: AuthenticatedUser, incident: Incident): void {
    if (user.role === UserRole.ADMIN) {
      return;
    }

    if (user.role === UserRole.COMPANY_ADMIN) {
      if (incident.companyId !== user.companyId) {
        throw new ForbiddenException('You do not have access to this company resource');
      }
      return;
    }

    if (incident.guardId !== user.sub) {
      throw new ForbiddenException('You do not have access to this incident');
    }
  }
}
