import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { inferPatrolSourceType } from '@/common/utils/patrol-source.util';
import {
  readDesktopWorkspaceConfig,
  writeDesktopWorkspaceConfigPatch,
} from '@/desktop/desktop-config.util';
import { PatrolGroup } from './entities/patrol-group.entity';

export interface WhatsAppRuntimeGroupMapping {
  externalGroupId: string;
  sourceType: 'group' | 'contact';
  mappedGroupId: string;
  groupName: string;
  siteCode: string;
}

@Injectable()
export class WhatsAppSourceMappingService {
  private readonly logger = new Logger(WhatsAppSourceMappingService.name);
  private linkedAccountLoadLogged = false;

  constructor(
    @InjectRepository(PatrolGroup)
    private readonly patrolGroupRepo: Repository<PatrolGroup>,
  ) {}

  getConfiguredLinkedAccountId(): string | null {
    const account = readDesktopWorkspaceConfig().linkedWhatsAppAccountId?.trim() || null;
    if (!this.linkedAccountLoadLogged) {
      this.linkedAccountLoadLogged = true;
      if (account) {
        this.logger.log(`LINKED_ACCOUNT_LOADED account=${account}`);
      }
    }

    return account;
  }

  resolveActiveLinkedAccountId(fallbackConnectedAccount?: string | null): string | null {
    return this.getConfiguredLinkedAccountId() || fallbackConnectedAccount?.trim() || null;
  }

  isMappingEligibleForIngest(group: PatrolGroup, linkedAccountId: string | null): boolean {
    if (!group.active || !group.externalGroupId?.trim()) {
      return false;
    }

    if (group.site?.active === false) {
      return false;
    }

    const mappingAccountId = group.linkedAccountId?.trim() || null;
    if (!linkedAccountId) {
      return !mappingAccountId;
    }

    if (!mappingAccountId) {
      return true;
    }

    return mappingAccountId === linkedAccountId;
  }

  async rehydratePersistedMappingsOnStartup(): Promise<{
    persistedActive: number;
    ingestEligible: number;
    linkedAccountBackfilled: number;
    linkedAccountId: string | null;
  }> {
    const linkedAccountBackfilled = await this.backfillMissingLinkedAccountIds();
    const linkedAccountId = this.getConfiguredLinkedAccountId();
    const activeGroups = await this.patrolGroupRepo.find({
      where: { active: true },
      relations: ['site'],
    });

    const persistedActive = activeGroups.filter((group) => Boolean(group.externalGroupId?.trim())).length;
    const ingestEligible = activeGroups.filter((group) =>
      this.isMappingEligibleForIngest(group, linkedAccountId),
    ).length;

    return {
      persistedActive,
      ingestEligible,
      linkedAccountBackfilled,
      linkedAccountId,
    };
  }

  private async backfillMissingLinkedAccountIds(): Promise<number> {
    const linkedAccountId = readDesktopWorkspaceConfig().linkedWhatsAppAccountId?.trim();
    if (!linkedAccountId) {
      return 0;
    }

    const groups = await this.patrolGroupRepo.find({
      where: { active: true },
    });

    let updated = 0;
    for (const group of groups) {
      if (!group.externalGroupId?.trim() || group.linkedAccountId?.trim()) {
        continue;
      }

      group.linkedAccountId = linkedAccountId;
      await this.patrolGroupRepo.save(group);
      updated += 1;
    }

    if (updated > 0) {
      this.logger.log(`BOOTSTRAP_MAPPING_LINKED_ACCOUNT_BACKFILLED count=${updated} account=${linkedAccountId}`);
    }

    return updated;
  }

  async findActiveMappingsForIngest(linkedAccountId?: string | null): Promise<PatrolGroup[]> {
    const accountId = linkedAccountId ?? this.getConfiguredLinkedAccountId();
    const groups = await this.patrolGroupRepo.find({
      where: { active: true },
      relations: ['site', 'site.company'],
    });

    return groups.filter((group) => this.isMappingEligibleForIngest(group, accountId));
  }

  async resolveMappingForIngest(
    externalGroupId: string,
    linkedAccountId?: string | null,
  ): Promise<PatrolGroup | null> {
    const normalizedExternalGroupId = externalGroupId.trim();
    const mappings = await this.findActiveMappingsForIngest(linkedAccountId);
    return mappings.find((group) => group.externalGroupId?.trim() === normalizedExternalGroupId) ?? null;
  }

  async toRuntimeMappings(linkedAccountId?: string | null): Promise<WhatsAppRuntimeGroupMapping[]> {
    const mappings = await this.findActiveMappingsForIngest(linkedAccountId);
    return mappings.map((group) => ({
      externalGroupId: group.externalGroupId as string,
      sourceType: (group.sourceType ?? inferPatrolSourceType(group.externalGroupId as string)) as
        | 'group'
        | 'contact',
      mappedGroupId: group.id,
      groupName: group.groupName,
      siteCode: group.site.siteCode,
    }));
  }

  async countActiveMappingsForIngest(linkedAccountId?: string | null): Promise<number> {
    const mappings = await this.findActiveMappingsForIngest(linkedAccountId);
    return mappings.length;
  }

  async persistLinkedWhatsAppAccount(
    accountId: string,
  ): Promise<{ changed: boolean; previousAccountId: string | null; currentAccountId: string }> {
    const normalized = accountId.trim();
    if (!normalized) {
      return {
        changed: false,
        previousAccountId: this.getConfiguredLinkedAccountId(),
        currentAccountId: this.getConfiguredLinkedAccountId() ?? '',
      };
    }

    const previousAccountId = this.getConfiguredLinkedAccountId();
    if (previousAccountId === normalized) {
      return { changed: false, previousAccountId, currentAccountId: normalized };
    }

    writeDesktopWorkspaceConfigPatch({ linkedWhatsAppAccountId: normalized });
    this.logger.log(`LINKED_ACCOUNT_SAVED account=${normalized}`);

    if (previousAccountId) {
      this.logger.log(
        `whatsapp-linked-account-changed previous=${previousAccountId} current=${normalized}`,
      );
    } else {
      this.logger.log(`whatsapp-linked-account-set account=${normalized}`);
    }

    return { changed: true, previousAccountId, currentAccountId: normalized };
  }
}
