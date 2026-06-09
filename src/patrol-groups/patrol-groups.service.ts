import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  async create(dto: CreatePatrolGroupDto, user: AuthenticatedUser): Promise<PatrolGroup> {
    await this.sitesService.findOne(dto.siteId, user);
    const normalized = this.normalizeSourceMapping(dto);
    const linkedAccountId = this.resolveLinkedAccountIdForWrite(dto.linkedAccountId, normalized.externalGroupId);
    await this.assertNoDuplicateActiveMapping(linkedAccountId, normalized.externalGroupId);

    return this.groupsRepo.save(
      this.groupsRepo.create({
        ...dto,
        ...normalized,
        linkedAccountId,
      }),
    );
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

    return query.getMany();
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
    return group;
  }

  async update(id: string, dto: UpdatePatrolGroupDto, user: AuthenticatedUser): Promise<PatrolGroup> {
    if (dto.siteId) {
      await this.sitesService.findOne(dto.siteId, user);
    }
    const group = await this.findOne(id, user);
    const normalized = this.normalizeSourceMapping({
      externalGroupId: dto.externalGroupId ?? group.externalGroupId ?? undefined,
      sourceType: dto.sourceType ?? group.sourceType,
    });
    const linkedAccountId = this.resolveLinkedAccountIdForWrite(
      dto.linkedAccountId ?? group.linkedAccountId,
      normalized.externalGroupId,
    );
    const nextActive = dto.active ?? group.active;
    if (nextActive && normalized.externalGroupId) {
      await this.assertNoDuplicateActiveMapping(linkedAccountId, normalized.externalGroupId, group.id);
    }

    return this.groupsRepo.save({
      ...group,
      ...dto,
      ...normalized,
      linkedAccountId,
      active: nextActive,
    });
  }

  private resolveLinkedAccountIdForWrite(
    requestedLinkedAccountId: string | undefined,
    externalGroupId: string | undefined,
  ): string | undefined {
    const normalizedRequested = requestedLinkedAccountId?.trim();
    if (normalizedRequested) {
      return normalizedRequested;
    }

    if (!externalGroupId?.trim()) {
      return undefined;
    }

    return this.whatsAppSourceMappingService.getConfiguredLinkedAccountId() ?? undefined;
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
        `An active mapping already exists for WhatsApp source ${normalizedExternalGroupId} on account ${normalizedLinkedAccountId}.`,
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
  }
}
