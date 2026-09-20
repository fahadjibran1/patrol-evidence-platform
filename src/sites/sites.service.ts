import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, QueryFailedError, Repository } from 'typeorm';
import { Site } from './entities/site.entity';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';
import { AuthenticatedUser } from '@/auth/interfaces/authenticated-request.interface';
import { UserRole } from '@/common/enums/user-role.enum';
import { Company } from '@/companies/entities/company.entity';
import { PatrolGroup } from '@/patrol-groups/entities/patrol-group.entity';
import { PatrolSchedule } from '@/patrol-schedules/entities/patrol-schedule.entity';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';
import { PatrolSlot } from '@/patrol-slots/entities/patrol-slot.entity';
import { PatrolAlert } from '@/patrol-alerts/entities/patrol-alert.entity';
import { Incident } from '@/incidents/entities/incident.entity';
import { ShiftGuardAssignment } from '@/dashboard/entities/shift-guard-assignment.entity';

export interface SiteArchivePreview {
  siteId: string;
  siteCode: string;
  siteName: string;
  mappedGroups: number;
  schedules: number;
  patrolImages: number;
  patrolSlots: number;
  patrolAlerts: number;
  incidents: number;
  shiftAssignments: number;
  mappingConflictRecords: number;
  mayDeletePermanently: boolean;
}

@Injectable()
export class SitesService {
  private readonly logger = new Logger(SitesService.name);
  private readonly lifecycleListeners = new Set<() => void>();

  constructor(
    @InjectRepository(Site)
    private readonly sitesRepo: Repository<Site>,
    @InjectRepository(Company)
    private readonly companiesRepo: Repository<Company>,
    @InjectRepository(PatrolGroup)
    private readonly groupRepo: Repository<PatrolGroup>,
    @InjectRepository(PatrolSchedule)
    private readonly scheduleRepo: Repository<PatrolSchedule>,
    @InjectRepository(PatrolImage)
    private readonly imageRepo: Repository<PatrolImage>,
    @InjectRepository(PatrolSlot)
    private readonly slotRepo: Repository<PatrolSlot>,
  ) {}

  subscribeToLifecycleChanges(listener: () => void): () => void {
    this.lifecycleListeners.add(listener);
    return () => this.lifecycleListeners.delete(listener);
  }

  private notifyLifecycleChanged(): void {
    for (const listener of this.lifecycleListeners) listener();
  }

  async create(dto: CreateSiteDto, user: AuthenticatedUser): Promise<Site> {
    const companyId = await this.resolveTargetCompanyId(user, dto.companyId);

    try {
      return await this.sitesRepo.save(
        this.sitesRepo.create({
          ...dto,
          companyId,
          siteCode: dto.siteCode.trim().toUpperCase(),
          siteName: dto.siteName.trim(),
          clientName: dto.clientName?.trim() || undefined,
          archivedAt: null,
        }),
      );
    } catch (error) {
      this.rethrowKnownPersistenceError(error, dto.siteCode);
      throw error;
    }
  }

  async findAll(user: AuthenticatedUser, includeArchived = false): Promise<Site[]> {
    const query = this.sitesRepo
      .createQueryBuilder('site')
      .leftJoinAndSelect('site.company', 'company')
      .orderBy('site.siteCode', 'ASC');

    if (!includeArchived) {
      query.andWhere('site.archivedAt IS NULL');
    }

    if (!this.isPlatformAdmin(user)) {
      query.andWhere('site.companyId = :companyId', { companyId: user.companyId });
    }

    return query.getMany();
  }

  async findOne(id: string, user: AuthenticatedUser): Promise<Site> {
    const site = await this.sitesRepo.findOne({
      where: { id },
      relations: ['company'],
    });

    if (!site) {
      throw new NotFoundException(`Site ${id} not found`);
    }

    this.assertCompanyAccess(user, site.companyId);
    return site;
  }

  async findActiveById(id: string, user: AuthenticatedUser): Promise<Site> {
    const site = await this.findOne(id, user);
    if (!site.active || site.archivedAt) {
      throw new NotFoundException(`Active site ${id} not found`);
    }
    return site;
  }

  async findActiveByCode(siteCode: string, user: AuthenticatedUser): Promise<Site> {
    const normalizedSiteCode = siteCode.trim().toUpperCase();
    const site = await this.sitesRepo.findOne({
      where: this.isPlatformAdmin(user)
        ? { siteCode: normalizedSiteCode, active: true, archivedAt: IsNull() }
        : {
            siteCode: normalizedSiteCode,
            active: true,
            archivedAt: IsNull(),
            companyId: user.companyId ?? undefined,
          },
      relations: ['company'],
    });

    if (!site) {
      throw new NotFoundException(`Active site with code ${normalizedSiteCode} not found`);
    }

    return site;
  }

  async update(id: string, dto: UpdateSiteDto, user: AuthenticatedUser): Promise<Site> {
    const site = await this.findOne(id, user);
    if (site.archivedAt) {
      throw new ConflictException(`Archived site ${site.siteCode} must be restored before editing`);
    }

    const companyId = dto.companyId ? await this.resolveTargetCompanyId(user, dto.companyId) : site.companyId;

    try {
      const saved = await this.sitesRepo.save({
        ...site,
        ...dto,
        companyId,
        siteCode: dto.siteCode ? dto.siteCode.trim().toUpperCase() : site.siteCode,
        siteName: dto.siteName ? dto.siteName.trim() : site.siteName,
        clientName: dto.clientName !== undefined ? dto.clientName.trim() || undefined : site.clientName,
      });
      if (site.active !== saved.active) this.notifyLifecycleChanged();
      return saved;
    } catch (error) {
      this.rethrowKnownPersistenceError(error, dto.siteCode ?? site.siteCode);
      throw error;
    }
  }

  async getArchivePreview(id: string, user: AuthenticatedUser): Promise<SiteArchivePreview> {
    const site = await this.findOne(id, user);
    const [mappedGroups, schedules, patrolImages, patrolSlots, patrolAlerts, incidents, shiftAssignments] = await Promise.all([
      this.groupRepo.count({ where: { siteId: site.id, active: true } }),
      this.scheduleRepo.count({ where: { siteId: site.id } }),
      this.imageRepo.count({ where: { siteId: site.id } }),
      this.slotRepo.count({ where: { siteId: site.id } }),
      this.sitesRepo.manager.getRepository(PatrolAlert).count({ where: { siteId: site.id } }),
      this.sitesRepo.manager.getRepository(Incident).count({ where: { siteId: site.id } }),
      this.sitesRepo.manager.getRepository(ShiftGuardAssignment).count({ where: { siteId: site.id } }),
    ]);
    const groupIds = (await this.groupRepo.find({ where: { siteId: site.id }, select: ['id'] })).map((group) => group.id);
    const mappingConflictRecords = groupIds.length === 0 ? 0 : Number((await this.sitesRepo.manager
      .createQueryBuilder()
      .select('COUNT(*)', 'count')
      .from('patrol_migration_conflicts', 'conflict')
      .where('conflict.recordId IN (:...groupIds)', { groupIds })
      .getRawOne<{ count: string }>())?.count ?? 0);

    return {
      siteId: site.id,
      siteCode: site.siteCode,
      siteName: site.siteName,
      mappedGroups,
      schedules,
      patrolImages,
      patrolSlots,
      patrolAlerts,
      incidents,
      shiftAssignments,
      mappingConflictRecords,
      mayDeletePermanently: patrolImages + patrolSlots + patrolAlerts + incidents + shiftAssignments + mappingConflictRecords === 0,
    };
  }

  async archive(id: string, user: AuthenticatedUser, reason?: string): Promise<Site> {
    const site = await this.findOne(id, user);
    this.logger.log(
      `SITE_ARCHIVE_REQUESTED siteId=${site.id} siteCode=${site.siteCode} actor=${user.sub} reason=${reason ?? 'none'}`,
    );

    try {
      if (site.archivedAt) {
        return site;
      }

      const archived = await this.sitesRepo.manager.transaction(async (manager) => {
        await manager.update(PatrolGroup, { siteId: site.id, active: true }, { active: false });
        await manager.update(PatrolSchedule, { siteId: site.id, active: true }, { active: false });
        return manager.save(Site, { ...site, active: false, archivedAt: new Date() });
      });
      this.notifyLifecycleChanged();

      this.logger.log(
        `SITE_ARCHIVED siteId=${archived.id} siteCode=${archived.siteCode} actor=${user.sub} timestamp=${archived.archivedAt?.toISOString()} reason=${reason ?? 'none'}`,
      );

      return archived;
    } catch (error) {
      this.logger.error(
        `SITE_ARCHIVE_FAILED siteId=${site.id} siteCode=${site.siteCode} actor=${user.sub} error=${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async restore(id: string, user: AuthenticatedUser): Promise<Site> {
    const site = await this.findOne(id, user);
    if (!site.archivedAt) {
      return site;
    }

    const restored = await this.sitesRepo.save({
      ...site,
      active: true,
      archivedAt: null,
    });
    // Restoring a site must not reclaim groups that may now belong to another site.
    this.notifyLifecycleChanged();

    this.logger.log(
      `SITE_RESTORED siteId=${restored.id} siteCode=${restored.siteCode} actor=${user.sub} timestamp=${new Date().toISOString()}`,
    );

    return restored;
  }

  async deleteEmpty(id: string, user: AuthenticatedUser, confirmSiteCode: string): Promise<void> {
    const site = await this.findOne(id, user);
    if (confirmSiteCode.trim().toUpperCase() !== site.siteCode) {
      throw new ConflictException('Type the site code exactly to confirm permanent deletion.');
    }
    await this.sitesRepo.manager.transaction(async (manager) => {
      for (const entity of [PatrolImage, PatrolSlot, PatrolAlert, Incident, ShiftGuardAssignment]) {
        if (await manager.getRepository(entity).count({ where: { siteId: site.id } })) {
          throw new ConflictException('This site has historical records and cannot be permanently deleted. Archive it instead.');
        }
      }
      const groups = await manager.getRepository(PatrolGroup).find({ where: { siteId: site.id }, select: ['id'] });
      if (groups.length > 0) {
        const conflicts = await manager.createQueryBuilder()
          .select('COUNT(*)', 'count')
          .from('patrol_migration_conflicts', 'conflict')
          .where('conflict.recordId IN (:...groupIds)', { groupIds: groups.map((group) => group.id) })
          .getRawOne<{ count: string }>();
        if (Number(conflicts?.count ?? 0) > 0) {
          throw new ConflictException('This site has mapping audit history and cannot be permanently deleted. Archive it instead.');
        }
      }
      await manager.delete(PatrolSchedule, { siteId: site.id });
      await manager.delete(PatrolGroup, { siteId: site.id });
      const deleted = await manager.delete(Site, { id: site.id });
      if (deleted.affected !== 1) throw new ConflictException('The site changed during deletion. Try again.');
    });
    this.notifyLifecycleChanged();
  }

  /** Legacy route remains archive-only for existing callers. */
  async remove(id: string, user: AuthenticatedUser): Promise<void> {
    await this.archive(id, user, 'delete-endpoint');
  }

  assertCompanyAccess(user: AuthenticatedUser, companyId: string): void {
    if (this.isPlatformAdmin(user)) {
      return;
    }

    if (!user.companyId || user.companyId !== companyId) {
      throw new ForbiddenException('You do not have access to this company resource');
    }
  }

  private async resolveTargetCompanyId(user: AuthenticatedUser, requestedCompanyId?: string): Promise<string> {
    if (!this.isPlatformAdmin(user)) {
      if (!user.companyId) {
        throw new ForbiddenException('User is not assigned to a company');
      }

      if (requestedCompanyId && requestedCompanyId !== user.companyId) {
        throw new ForbiddenException('You do not have access to this company resource');
      }

      return user.companyId;
    }

    const companyId = requestedCompanyId?.trim();
    if (!companyId) {
      throw new ForbiddenException('companyId is required for admin site creation');
    }

    const company = await this.companiesRepo.findOne({
      where: { id: companyId, active: true },
    });

    if (!company) {
      throw new NotFoundException(`Active company ${companyId} not found`);
    }

    return company.id;
  }

  private isPlatformAdmin(user: AuthenticatedUser): boolean {
    return user.role === UserRole.ADMIN;
  }

  private rethrowKnownPersistenceError(error: unknown, siteCode: string): void {
    if (
      error instanceof QueryFailedError &&
      typeof (error as { driverError?: { code?: string } }).driverError?.code === 'string' &&
      (error as { driverError?: { code?: string } }).driverError?.code === '23505'
    ) {
      throw new ConflictException(`Site code ${siteCode.trim().toUpperCase()} already exists`);
    }
  }
}
