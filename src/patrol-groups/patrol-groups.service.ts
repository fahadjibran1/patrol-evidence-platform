import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PatrolGroup } from './entities/patrol-group.entity';
import { CreatePatrolGroupDto } from './dto/create-patrol-group.dto';
import { UpdatePatrolGroupDto } from './dto/update-patrol-group.dto';
import { SitesService } from '@/sites/sites.service';
import { AuthenticatedUser } from '@/auth/interfaces/authenticated-request.interface';
import { UserRole } from '@/common/enums/user-role.enum';
import { PatrolSourceType } from '@/common/enums/patrol-source-type.enum';
import { inferPatrolSourceType } from '@/common/utils/patrol-source.util';
import { WhatsAppSourceMappingService } from './whatsapp-source-mapping.service';

@Injectable()
export class PatrolGroupsService {
  constructor(
    @InjectRepository(PatrolGroup) private readonly groupsRepo: Repository<PatrolGroup>,
    private readonly sitesService: SitesService,
    private readonly whatsAppSourceMappingService: WhatsAppSourceMappingService,
  ) {}

  async getSourceAvailability(sourceIds: string[], user: AuthenticatedUser): Promise<Array<{
    sourceId: string;
    status: 'available' | 'mapped-here' | 'mapped-elsewhere';
  }>> {
    const accountId = this.whatsAppSourceMappingService.getConfiguredLinkedAccountId();
    if (!accountId) {
      throw new BadRequestException('Connect WhatsApp before managing group mappings.');
    }
    const ids = [...new Set(sourceIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length === 0) return [];
    const existing = await this.groupsRepo.find({
      where: { linkedAccountId: accountId, externalGroupId: In(ids), active: true },
      relations: ['site'],
    });
    const bySource = new Map(existing.map((group) => [group.externalGroupId?.trim(), group]));
    return ids.map((sourceId) => {
      const group = bySource.get(sourceId);
      return {
        sourceId,
        status: !group ? 'available' : user.role === UserRole.ADMIN || group.site.companyId === user.companyId
          ? 'mapped-here' : 'mapped-elsewhere',
      };
    });
  }

  async create(dto: CreatePatrolGroupDto, user: AuthenticatedUser): Promise<PatrolGroup> {
    await this.sitesService.findActiveById(dto.siteId, user);
    const normalized = this.normalizeSourceMapping(dto);
    const linkedAccountId = this.resolveLinkedAccountIdForWrite(
      dto.linkedAccountId,
      normalized.externalGroupId,
      user,
    );
    await this.assertNoDuplicateActiveMapping(linkedAccountId, normalized.externalGroupId);

    const saved = await this.groupsRepo.save(
      this.groupsRepo.create({
        ...dto,
        ...normalized,
        linkedAccountId,
      }),
    );
    this.whatsAppSourceMappingService.notifyMappingChanged();
    return saved;
  }

  async findAll(user: AuthenticatedUser): Promise<PatrolGroup[]> {
    const query = this.groupsRepo
      .createQueryBuilder('group')
      .leftJoinAndSelect('group.site', 'site')
      .leftJoinAndSelect('site.company', 'company')
      .orderBy('group.createdAt', 'DESC');

    if (user.role !== UserRole.ADMIN) {
      query.where('site.companyId = :companyId', { companyId: user.companyId });
    }

    const groups = await query.getMany();
    if (user.role === UserRole.ADMIN) {
      return groups;
    }
    const configuredAccount = this.whatsAppSourceMappingService.getConfiguredLinkedAccountId();
    return groups.filter(
      (group) => !group.externalGroupId?.trim() || group.linkedAccountId?.trim() === configuredAccount,
    );
  }

  async findOne(id: string, user: AuthenticatedUser): Promise<PatrolGroup> {
    const query = this.groupsRepo
      .createQueryBuilder('group')
      .leftJoinAndSelect('group.site', 'site')
      .leftJoinAndSelect('site.company', 'company')
      .where('group.id = :id', { id });

    if (user.role !== UserRole.ADMIN) {
      query.andWhere('site.companyId = :companyId', { companyId: user.companyId });
    }

    const group = await query.getOne();
    if (!group) {
      throw new NotFoundException(`Patrol group ${id} not found`);
    }
    this.assertCustomerAccountScope(group, user);
    return group;
  }

  async update(id: string, dto: UpdatePatrolGroupDto, user: AuthenticatedUser): Promise<PatrolGroup> {
    const targetSite = dto.siteId ? await this.sitesService.findActiveById(dto.siteId, user) : undefined;
    const group = await this.findOne(id, user);
    const normalized = this.normalizeSourceMapping({
      externalGroupId: dto.externalGroupId ?? group.externalGroupId ?? undefined,
      sourceType: dto.sourceType ?? group.sourceType,
    });
    const linkedAccountId = this.resolveLinkedAccountIdForWrite(
      dto.linkedAccountId ?? group.linkedAccountId,
      normalized.externalGroupId,
      user,
    );
    const nextActive = dto.active ?? group.active;
    if (nextActive && !targetSite) await this.sitesService.findActiveById(group.siteId, user);
    if (nextActive && normalized.externalGroupId) {
      await this.assertNoDuplicateActiveMapping(linkedAccountId, normalized.externalGroupId, group.id);
    }

    const saved = await this.groupsRepo.save({
      ...group,
      ...dto,
      ...normalized,
      linkedAccountId,
      active: nextActive,
      site: targetSite ?? group.site,
    });
    if (saved.active) {
      await this.resolveMigrationConflict(saved.id);
    }
    this.whatsAppSourceMappingService.notifyMappingChanged();
    return saved;
  }

  private resolveLinkedAccountIdForWrite(
    requestedLinkedAccountId: string | undefined,
    externalGroupId: string | undefined,
    user: AuthenticatedUser,
  ): string | undefined {
    const normalizedRequested = requestedLinkedAccountId?.trim();
    if (user.role === UserRole.ADMIN && normalizedRequested) {
      return normalizedRequested;
    }

    if (!externalGroupId?.trim()) {
      return undefined;
    }

    const configured = this.whatsAppSourceMappingService.getConfiguredLinkedAccountId() ?? undefined;
    if (user.role === UserRole.COMPANY_ADMIN) {
      if (!configured) {
        throw new BadRequestException('Connect WhatsApp before managing group mappings.');
      }
      if (normalizedRequested && normalizedRequested !== configured) {
        throw new BadRequestException('The selected group does not belong to the current WhatsApp connection.');
      }
    }
    return configured;
  }

  private assertCustomerAccountScope(group: PatrolGroup, user: AuthenticatedUser): void {
    if (user.role === UserRole.ADMIN || !group.externalGroupId?.trim()) {
      return;
    }
    const configured = this.whatsAppSourceMappingService.getConfiguredLinkedAccountId();
    if (!configured || group.linkedAccountId?.trim() !== configured) {
      throw new BadRequestException('This mapping does not belong to the current WhatsApp connection.');
    }
  }

  private async assertNoDuplicateActiveMapping(
    linkedAccountId: string | undefined,
    externalGroupId: string | undefined,
    excludeGroupId?: string,
  ): Promise<void> {
    const normalizedExternalGroupId = externalGroupId?.trim();
    const normalizedLinkedAccountId = linkedAccountId?.trim();
    if (!normalizedExternalGroupId || !normalizedLinkedAccountId) {
      return;
    }

    const duplicateQuery = this.groupsRepo
      .createQueryBuilder('group')
      .where('group.active = :active', { active: true })
      .andWhere('group.externalGroupId = :externalGroupId', { externalGroupId: normalizedExternalGroupId })
      .andWhere('group.linkedAccountId = :linkedAccountId', { linkedAccountId: normalizedLinkedAccountId });

    if (excludeGroupId) {
      duplicateQuery.andWhere('group.id != :excludeGroupId', { excludeGroupId });
    }

    const duplicate = await duplicateQuery.getOne();
    if (duplicate) {
      throw new BadRequestException(
        'This WhatsApp group is already mapped. Choose another group or ask an administrator to release it.',
      );
    }
  }

  private normalizeSourceMapping(
    dto: Pick<CreatePatrolGroupDto, 'externalGroupId' | 'sourceType'>,
  ): Pick<CreatePatrolGroupDto, 'externalGroupId' | 'sourceType'> {
    const externalGroupId = dto.externalGroupId?.trim() || undefined;
    const sourceType =
      dto.sourceType ?? (externalGroupId ? inferPatrolSourceType(externalGroupId) : PatrolSourceType.GROUP);

    if (externalGroupId) {
      if (sourceType === PatrolSourceType.GROUP && !externalGroupId.endsWith('@g.us')) {
        throw new BadRequestException('Group sources must use a WhatsApp group ID ending in @g.us.');
      }
      if (sourceType === PatrolSourceType.CONTACT && !externalGroupId.endsWith('@c.us')) {
        throw new BadRequestException('Contact sources must use a WhatsApp contact/chat ID ending in @c.us.');
      }
    }

    return { externalGroupId, sourceType };
  }

  async remove(id: string, user: AuthenticatedUser): Promise<void> {
    const group = await this.findOne(id, user);
    await this.groupsRepo.remove(group);
    await this.resolveMigrationConflict(id);
    this.whatsAppSourceMappingService.notifyMappingChanged();
  }

  private async resolveMigrationConflict(recordId: string): Promise<void> {
    if (!this.groupsRepo.manager?.query) return;
    try {
      await this.groupsRepo.manager.query(
        `UPDATE "patrol_migration_conflicts" SET "resolvedAt" = CURRENT_TIMESTAMP WHERE "recordId" = ? AND "resolvedAt" IS NULL`,
        [recordId],
      );
    } catch {
      // Databases created after the migration may not contain a conflict record.
    }
  }
}
