import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PatrolAlert } from './entities/patrol-alert.entity';
import { PatrolAlertType } from '@/common/enums/patrol-alert-type.enum';
import { SitesService } from '@/sites/sites.service';
import { AuthenticatedUser } from '@/auth/interfaces/authenticated-request.interface';
import { UserRole } from '@/common/enums/user-role.enum';
import { CreatePatrolAlertDto } from './dto/create-patrol-alert.dto';

@Injectable()
export class PatrolAlertsService {
  constructor(
    @InjectRepository(PatrolAlert)
    private readonly alertsRepo: Repository<PatrolAlert>,
    private readonly sitesService: SitesService,
  ) {}

  async createMissingAlert(params: {
    siteId: string;
    slotId: string;
    alertTime: Date;
    alertMessage: string;
  }): Promise<PatrolAlert> {
    const existing = await this.alertsRepo.findOne({
      where: {
        siteId: params.siteId,
        slotId: params.slotId,
        alertType: PatrolAlertType.MISSING_PATROL,
      },
    });

    if (existing) {
      return existing;
    }

    return this.alertsRepo.save(
      this.alertsRepo.create({
        siteId: params.siteId,
        slotId: params.slotId,
        guardId: null,
        alertType: PatrolAlertType.MISSING_PATROL,
        alertTime: params.alertTime,
        alertMessage: params.alertMessage,
        isResolved: false,
      }),
    );
  }

  async createGuardAlert(dto: CreatePatrolAlertDto, user: AuthenticatedUser): Promise<PatrolAlert> {
    if (user.role !== UserRole.GUARD) {
      throw new ForbiddenException('Only guards can trigger patrol alerts');
    }

    if (!user.companyId) {
      throw new ForbiddenException('Guard is not assigned to a company');
    }

    const site = await this.sitesService.findActiveById(dto.siteId, user);

    return this.alertsRepo.save(
      this.alertsRepo.create({
        siteId: site.id,
        slotId: null,
        guardId: user.sub,
        alertType: dto.alertType,
        alertTime: new Date(),
        alertMessage: dto.alertMessage.trim(),
        isResolved: false,
        resolvedAt: null,
      }),
    );
  }

  async findAll(user: AuthenticatedUser): Promise<PatrolAlert[]> {
    const query = this.alertsRepo
      .createQueryBuilder('alert')
      .leftJoinAndSelect('alert.site', 'site')
      .leftJoinAndSelect('alert.slot', 'slot')
      .leftJoinAndSelect('alert.guard', 'guard')
      .orderBy('alert.createdAt', 'DESC');

    if (user.role === UserRole.ADMIN) {
      return query.getMany();
    }

    if (user.role === UserRole.COMPANY_ADMIN) {
      query.where('site.companyId = :companyId', { companyId: user.companyId });
      return query.getMany();
    }

    query.where('alert.guardId = :guardId', { guardId: user.sub });
    return query.getMany();
  }

  async findOne(id: string, user: AuthenticatedUser): Promise<PatrolAlert> {
    const alert = await this.alertsRepo.findOne({
      where: { id },
      relations: ['site', 'slot', 'guard'],
    });

    if (!alert) {
      throw new NotFoundException(`Patrol alert ${id} not found`);
    }

    this.assertAccess(user, alert);
    return alert;
  }

  async resolve(id: string, user: AuthenticatedUser): Promise<PatrolAlert> {
    if (user.role === UserRole.GUARD) {
      throw new ForbiddenException('Guards cannot resolve patrol alerts');
    }

    const alert = await this.findOne(id, user);
    if (alert.isResolved) {
      return alert;
    }

    alert.isResolved = true;
    alert.resolvedAt = new Date();
    return this.alertsRepo.save(alert);
  }

  private assertAccess(user: AuthenticatedUser, alert: PatrolAlert): void {
    if (user.role === UserRole.ADMIN) {
      return;
    }

    if (user.role === UserRole.COMPANY_ADMIN) {
      this.sitesService.assertCompanyAccess(user, alert.siteId ? alert.site.companyId : '');
      return;
    }

    if (alert.guardId !== user.sub) {
      throw new ForbiddenException('You do not have access to this patrol alert');
    }
  }
}
