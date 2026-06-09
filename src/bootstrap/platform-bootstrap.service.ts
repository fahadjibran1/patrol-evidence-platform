import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WhatsAppCollectorService } from '@/collectors/whatsapp-collector.service';
import { PatrolGroup } from '@/patrol-groups/entities/patrol-group.entity';
import { WhatsAppSourceMappingService } from '@/patrol-groups/whatsapp-source-mapping.service';
import { PatrolSchedule } from '@/patrol-schedules/entities/patrol-schedule.entity';
import { Site } from '@/sites/entities/site.entity';
import { readDesktopWorkspaceConfig, writeDesktopWorkspaceConfigPatch } from '@/desktop/desktop-config.util';
import { resolveSqliteDatabasePath } from '@/config/database-settings.util';

@Injectable()
export class PlatformBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PlatformBootstrapService.name);
  private bootstrapCompleted = false;

  constructor(
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
    @InjectRepository(PatrolSchedule)
    private readonly patrolScheduleRepo: Repository<PatrolSchedule>,
    private readonly whatsAppSourceMappingService: WhatsAppSourceMappingService,
    private readonly whatsAppCollectorService: WhatsAppCollectorService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.runStartupBootstrap();
  }

  async runStartupBootstrap(): Promise<void> {
    if (this.bootstrapCompleted) {
      return;
    }

    try {
      this.persistSqliteDatabasePathIfMissing();
      await this.loadAndLogSites();
      const mappingSummary = await this.whatsAppSourceMappingService.rehydratePersistedMappingsOnStartup();
      this.logger.log(
        `BOOTSTRAP_MAPPINGS_LOADED persisted=${mappingSummary.persistedActive} ingestEligible=${mappingSummary.ingestEligible} linkedAccountBackfilled=${mappingSummary.linkedAccountBackfilled} linkedAccount=${mappingSummary.linkedAccountId ?? 'none'}`,
      );
      await this.loadAndLogSchedules();
      const runtimeMappedGroups = await this.whatsAppCollectorService.refreshRuntimeMappingsFromDatabase();
      this.logger.log(
        `BOOTSTRAP_DASHBOARD_READY runtimeMappedGroups=${runtimeMappedGroups} persistedMappings=${mappingSummary.persistedActive}`,
      );
      this.bootstrapCompleted = true;
    } catch (error) {
      this.logger.error(
        `BOOTSTRAP_DASHBOARD_READY failed ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
      );
    }
  }

  isBootstrapCompleted(): boolean {
    return this.bootstrapCompleted;
  }

  private persistSqliteDatabasePathIfMissing(): void {
    if (!process.env.DESKTOP_CONFIG_PATH?.trim()) {
      return;
    }

    const workspace = readDesktopWorkspaceConfig();
    if (workspace.sqliteDbPath?.trim()) {
      return;
    }

    const resolvedPath = resolveSqliteDatabasePath();
    writeDesktopWorkspaceConfigPatch({ sqliteDbPath: resolvedPath, dbType: workspace.dbType ?? 'sqlite' });
    this.logger.log(`BOOTSTRAP_SQLITE_PATH_PERSISTED path=${resolvedPath}`);
  }

  private async loadAndLogSites(): Promise<void> {
    const sites = await this.siteRepo.find({
      order: { siteCode: 'ASC' },
    });
    const activeSites = sites.filter((site) => site.active !== false);
    const siteSummary = sites
      .map((site) => `${site.siteCode}(${site.active === false ? 'inactive' : 'active'})`)
      .join(',');

    this.logger.log(
      `BOOTSTRAP_SITES_LOADED active=${activeSites.length} total=${sites.length} siteCodes=${siteSummary || 'none'}`,
    );
  }

  private async loadAndLogSchedules(): Promise<void> {
    const activeSchedules = await this.patrolScheduleRepo.count({
      where: { active: true },
    });

    this.logger.log(`BOOTSTRAP_SCHEDULES_LOADED active=${activeSchedules}`);
  }
}
