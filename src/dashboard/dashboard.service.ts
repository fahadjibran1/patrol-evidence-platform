import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthenticatedUser } from '@/auth/interfaces/authenticated-request.interface';
import { UserRole } from '@/common/enums/user-role.enum';
import {
  buildSiteSenderMergeKey,
  canonicalSenderKey,
  senderIdentityKeysOverlap,
  stripSourceFromSenderName,
} from '@/common/utils/sender-identity.util';
import { findActivePatrolSchedule } from '@/common/utils/patrol-schedule.util';
import { getPatrolTimeParts } from '@/common/utils/patrol-time.util';
import {
  queryWithChunkedInClause,
} from '@/common/utils/sqlite-in-query.util';
import {
  auditAggregationData,
  coerceSentAtToDate,
  dedupeSchedulesById,
  formatAggregationError,
  normalizeScheduleRecord,
  safeLocaleCompare,
  sanitizeSitesForAggregation,
  summarizeRecord,
} from '@/dashboard/dashboard-aggregation.util';
import {
  buildAggregateBucketKey,
  buildHourlyBucketsFromAggregates,
  HIGH_VOLUME_IMAGE_THRESHOLD,
  NON_COUNTABLE_IMAGE_STATUSES,
  parseAggregateCount,
  parseAggregateHour,
  RECENT_PATROL_IMAGES_LIMIT,
  SiteHourlyImageAggregate,
} from '@/dashboard/dashboard-image-aggregation.util';
import { PatrolSchedule } from '@/patrol-schedules/entities/patrol-schedule.entity';
import { PatrolAlert } from '@/patrol-alerts/entities/patrol-alert.entity';
import { PatrolGroup } from '@/patrol-groups/entities/patrol-group.entity';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';
import {
  dedupePatrolImagesForCount,
  filterPatrolImagesForPatrolDate,
  getPatrolDateUtcBounds,
  imagePatrolHourFromSentAt,
  isCountablePatrolImage,
} from '@/patrol-images/patrol-image-query.util';
import { Site } from '@/sites/entities/site.entity';
import { User } from '@/users/entities/user.entity';
import { GuardSenderMapping } from './entities/guard-sender-mapping.entity';
import { ShiftGuardAssignment } from './entities/shift-guard-assignment.entity';

export type HourlySafetyStatus = 'Safe' | 'Missing' | 'Pending';
export type HourlyGuardStatus = 'Reported' | 'Missing';

export interface DashboardOverview {
  date: string;
  siteTotals: {
    active: number;
    withScheduledSlots: number;
  };
  slotTotals: Record<string, number>;
  imageTotals: {
    received: number;
  };
  alerts: {
    unresolved: number;
  };
  recentImages: Array<{
    id: string;
    siteCode: string;
    sentAt: string;
    status: string;
    senderName?: string;
  }>;
}

export interface DashboardSiteRow {
  siteId: string;
  siteCode: string;
  siteName: string;
  clientName?: string;
  safeHours: number;
  missingHours: number;
  pendingHours: number;
  imagesReceived: number;
  unresolvedAlerts: number;
  latestImageAt: string | null;
}

export interface HourlySafetyCell {
  hour: number;
  status: HourlySafetyStatus;
  safeFlag: boolean;
  firstPictureTime: string | null;
  firstSenderName: string | null;
  firstImageId: string | null;
  imageCount: number;
}

export interface DashboardHourlySafetyRow {
  siteId: string;
  siteCode: string;
  siteName: string;
  groupId: string | null;
  groupName: string | null;
  hourlyCells: HourlySafetyCell[];
}

export interface HourlyGuardStatusEntry {
  guardId: string;
  guardName: string;
  status: HourlyGuardStatus;
  firstPictureTime: string | null;
  totalPicturesInHour: number;
  senderNumber: string | null;
}

export interface DashboardHourlyGuardStatusRow {
  date: string;
  siteId: string;
  siteCode: string;
  siteName: string;
  groupId: string | null;
  groupName: string | null;
  hour: number;
  siteStatus: HourlySafetyStatus;
  expectedGuards: HourlyGuardStatusEntry[];
}

interface SafetyRowDefinition {
  siteId: string;
  siteCode: string;
  siteName: string;
  clientName?: string;
  groupId: string | null;
  groupName: string | null;
}

interface HourBucket {
  hour: number;
  count: number;
  firstImage: PatrolImage | null;
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
    @InjectRepository(PatrolImage)
    private readonly imageRepo: Repository<PatrolImage>,
    @InjectRepository(PatrolAlert)
    private readonly alertRepo: Repository<PatrolAlert>,
    @InjectRepository(PatrolGroup)
    private readonly groupRepo: Repository<PatrolGroup>,
    @InjectRepository(GuardSenderMapping)
    private readonly guardSenderMappingRepo: Repository<GuardSenderMapping>,
    @InjectRepository(PatrolSchedule)
    private readonly patrolScheduleRepo: Repository<PatrolSchedule>,
  ) {}

  async getOverview(user: AuthenticatedUser, date?: string): Promise<DashboardOverview> {
    const selectedDate = this.normalizeDate(date);
    const companyFilter = this.buildCompanyFilter(user);

    this.logger.log(`DASHBOARD_REQUEST_START endpoint=overview date=${selectedDate} mode=ALL`);

    let activeSites = 0;
    let activeGroups = 0;
    let imagesReceived = 0;
    let unresolvedAlerts = 0;
    let hourlyRows: DashboardHourlySafetyRow[] = [];
    let recentImages: DashboardOverview['recentImages'] = [];

    try {
      activeSites = await this.siteRepo.count({ where: { active: true, ...companyFilter } });
    } catch (error) {
      this.logger.error(
        `DASHBOARD_ERROR_RECORD stage=overview-active-sites date=${selectedDate} ${formatAggregationError(error)}`,
      );
    }

    try {
      activeGroups = await this.groupRepo
        .createQueryBuilder('group')
        .innerJoin('group.site', 'site')
        .where('group.active = true')
        .andWhere('site.active = true')
        .andWhere(companyFilter.companyId ? 'site.companyId = :companyId' : '1=1', companyFilter)
        .getCount();
    } catch (error) {
      this.logger.error(
        `DASHBOARD_ERROR_RECORD stage=overview-active-groups date=${selectedDate} ${formatAggregationError(error)}`,
      );
    }

    try {
      imagesReceived = await this.countPatrolImagesForDate(user, selectedDate);
      this.logger.log(`DASHBOARD_IMAGE_COUNT date=${selectedDate} count=${imagesReceived}`);
    } catch (error) {
      this.logger.error(
        `DASHBOARD_ERROR_RECORD stage=overview-image-count date=${selectedDate} ${formatAggregationError(error)}`,
      );
    }

    try {
      unresolvedAlerts = await this.alertRepo
        .createQueryBuilder('alert')
        .innerJoin('alert.site', 'site')
        .where('alert.isResolved = false')
        .andWhere(companyFilter.companyId ? 'site.companyId = :companyId' : '1=1', companyFilter)
        .getCount();
    } catch (error) {
      this.logger.error(
        `DASHBOARD_ERROR_RECORD stage=overview-alerts date=${selectedDate} ${formatAggregationError(error)}`,
      );
    }

    try {
      hourlyRows = await this.getHourlySafety(user, selectedDate);
    } catch (error) {
      this.logger.error(
        `DASHBOARD_ERROR_RECORD stage=overview-hourly-safety date=${selectedDate} ${formatAggregationError(error)}`,
      );
    }

    try {
      recentImages = await this.loadRecentPatrolImages(user, selectedDate, RECENT_PATROL_IMAGES_LIMIT);
    } catch (error) {
      this.logger.error(
        `DASHBOARD_ERROR_RECORD stage=overview-recent-images date=${selectedDate} ${formatAggregationError(error)}`,
      );
    }

    return {
      date: selectedDate,
      siteTotals: {
        active: activeSites,
        withScheduledSlots: activeGroups,
      },
      slotTotals: this.buildHourlyTotals(hourlyRows),
      imageTotals: {
        received: imagesReceived,
      },
      alerts: {
        unresolved: unresolvedAlerts,
      },
      recentImages,
    };
  }

  async getSiteBreakdown(user: AuthenticatedUser, date?: string): Promise<DashboardSiteRow[]> {
    const selectedDate = this.normalizeDate(date);
    this.logger.log(`DASHBOARD_REQUEST_START endpoint=sites date=${selectedDate} mode=ALL`);

    try {
      return await this.buildSiteBreakdown(user, selectedDate);
    } catch (error) {
      this.logger.error(
        `DASHBOARD_ERROR_RECORD stage=site-breakdown date=${selectedDate} ${formatAggregationError(error)}`,
      );
      return [];
    }
  }

  private async buildSiteBreakdown(user: AuthenticatedUser, selectedDate: string): Promise<DashboardSiteRow[]> {
    const companyFilter = this.buildCompanyFilter(user);
    const [alerts, hourlyRows, imageCountsBySite, latestImageAtBySite, activeSites] = await Promise.all([
      this.alertRepo
        .createQueryBuilder('alert')
        .innerJoinAndSelect('alert.site', 'site')
        .where('alert.isResolved = false')
        .andWhere(companyFilter.companyId ? 'site.companyId = :companyId' : '1=1', companyFilter)
        .getMany(),
      this.getHourlySafety(user, selectedDate),
      this.countPatrolImagesBySiteForDate(user, selectedDate),
      this.loadLatestImageAtBySiteForDate(user, selectedDate),
      this.loadActiveSitesFromDatabase(user),
    ]);

    const alertsBySite = this.groupBySite(alerts);
    const rowsBySite = hourlyRows.reduce((map, row) => {
      const existing = map.get(row.siteId) ?? [];
      existing.push(row);
      map.set(row.siteId, existing);
      return map;
    }, new Map<string, DashboardHourlySafetyRow[]>());

    const siteIds = new Set<string>([
      ...activeSites.map((site) => site.id),
      ...rowsBySite.keys(),
    ]);

    return [...siteIds]
      .map((siteId) => {
        const persistedSite = activeSites.find((site) => site.id === siteId);
        const siteRows = rowsBySite.get(siteId) ?? [];
        const firstRow = siteRows[0];
        const allCells = siteRows.flatMap((row) => row.hourlyCells);

        return {
          siteId,
          siteCode: persistedSite?.siteCode ?? firstRow?.siteCode ?? 'UNKNOWN',
          siteName: persistedSite?.siteName ?? firstRow?.siteName ?? 'Unknown site',
          clientName: persistedSite?.clientName,
          safeHours: allCells.filter((cell) => cell.status === 'Safe').length,
          missingHours: allCells.filter((cell) => cell.status === 'Missing').length,
          pendingHours: allCells.filter((cell) => cell.status === 'Pending').length,
          imagesReceived: imageCountsBySite.get(siteId) ?? 0,
          unresolvedAlerts: (alertsBySite.get(siteId) ?? []).length,
          latestImageAt: latestImageAtBySite.get(siteId) ?? null,
        };
      })
      .sort((left, right) => safeLocaleCompare(left.siteCode, right.siteCode));
  }

  private async loadActiveSitesFromDatabase(user: AuthenticatedUser): Promise<Site[]> {
    const companyFilter = this.buildCompanyFilter(user);
    const sitesQuery = this.siteRepo
      .createQueryBuilder('site')
      .where('site.active = :active', { active: true })
      .orderBy('site.siteCode', 'ASC');

    if (companyFilter.companyId) {
      sitesQuery.andWhere('site.companyId = :companyId', companyFilter);
    }

    return sitesQuery.getMany();
  }

  async getHourlySafety(user: AuthenticatedUser, date?: string): Promise<DashboardHourlySafetyRow[]> {
    const selectedDate = this.normalizeDate(date);
    this.logger.log(`DASHBOARD_REQUEST_START endpoint=hourly-safety date=${selectedDate} mode=ALL`);

    let shell: Awaited<ReturnType<DashboardService['loadSafetyShell']>>;
    try {
      shell = await this.loadSafetyShell(user, selectedDate);
    } catch (error) {
      this.logger.error(
        `DASHBOARD_ERROR_RECORD stage=load-context endpoint=hourly-safety date=${selectedDate} ${formatAggregationError(error)}`,
      );
      try {
        const activeSites = await this.loadActiveSitesFromDatabase(user);
        const sitesWithGroups = await this.attachGroupsToSites(activeSites);
        const sites = sanitizeSitesForAggregation(sitesWithGroups);
        shell = {
          sites,
          rowDefinitions: this.buildRowDefinitionsFromSites(sites),
          schedules: [],
        };
      } catch (fallbackError) {
        this.logger.error(
          `DASHBOARD_ERROR_RECORD stage=load-context-fallback endpoint=hourly-safety date=${selectedDate} ${formatAggregationError(fallbackError)}`,
        );
        return [];
      }
    }

    const { rowDefinitions, sites } = shell;
    const currentPatrolTime = getPatrolTimeParts(new Date());
    const detailedRows: DashboardHourlySafetyRow[] = [];

    for (const [siteId, siteRows] of this.groupRowsBySiteId(rowDefinitions)) {
      const lead = siteRows[0];
      this.logger.log(`DASHBOARD_SITE_START siteCode=${lead.siteCode}`);

      try {
        const siteImageCount = await this.countPatrolImagesForSite(user, selectedDate, siteId);
        if (siteImageCount >= HIGH_VOLUME_IMAGE_THRESHOLD) {
          this.logger.log(
            `DASHBOARD_HIGH_VOLUME_SITE siteCode=${lead.siteCode} imageCount=${siteImageCount}`,
          );
        }

        const buckets = await this.buildHourlyBucketsForSite(
          user,
          selectedDate,
          siteId,
          siteRows,
          siteImageCount,
          sites,
        );

        for (const row of siteRows) {
          try {
            detailedRows.push({
              siteId: row.siteId,
              siteCode: row.siteCode,
              siteName: row.siteName,
              groupId: row.groupId,
              groupName: row.groupName,
              hourlyCells: this.buildHourlyCells(row, buckets, selectedDate, currentPatrolTime),
            });
          } catch (error) {
            this.logDashboardErrorRecord('hourly-safety-group', row, error);
            detailedRows.push({
              siteId: row.siteId,
              siteCode: row.siteCode,
              siteName: row.siteName,
              groupId: row.groupId,
              groupName: row.groupName,
              hourlyCells: this.buildDegradedHourlyCells(selectedDate, currentPatrolTime),
            });
          }
        }

        this.logger.log(
          `DASHBOARD_SITE_SUCCESS siteCode=${lead.siteCode} imageCount=${siteImageCount}`,
        );
      } catch (error) {
        this.logger.error(
          `DASHBOARD_SITE_SKIPPED siteCode=${lead.siteCode} ${formatAggregationError(error)}`,
        );

        for (const row of siteRows) {
          detailedRows.push({
            siteId: row.siteId,
            siteCode: row.siteCode,
            siteName: row.siteName,
            groupId: row.groupId,
            groupName: row.groupName,
            hourlyCells: this.buildDegradedHourlyCells(selectedDate, currentPatrolTime),
          });
        }
      }
    }

    try {
      return this.aggregateHourlySafetyBySite(detailedRows);
    } catch (error) {
      this.logger.error(
        `DASHBOARD_ERROR_RECORD stage=aggregate-hourly-safety date=${selectedDate} ${formatAggregationError(error)}`,
      );
      return detailedRows.filter((row) => row.groupId === null);
    }
  }

  async getHourlyGuardStatus(
    user: AuthenticatedUser,
    date?: string,
    siteCode?: string,
    hour?: number,
    groupId?: string,
  ): Promise<DashboardHourlyGuardStatusRow[]> {
    const selectedDate = this.normalizeDate(date);
    const normalizedHour = this.normalizeHour(hour);
    const normalizedSiteCode = siteCode?.trim();
    const normalizedGroupId = groupId?.trim() || undefined;

    this.logger.log(
      `GUARDSAFE_REQUEST_START date=${selectedDate} siteCode=${normalizedSiteCode ?? 'ALL'} groupId=${normalizedGroupId ?? 'ALL'} hour=${normalizedHour ?? 'ALL'}`,
    );

    let shell: Awaited<ReturnType<DashboardService['loadSafetyShell']>>;
    try {
      shell = await this.loadSafetyShell(user, selectedDate, normalizedSiteCode);
    } catch (error) {
      this.logger.error(
        `GUARDSAFE_ERROR_RECORD stage=load-context date=${selectedDate} siteCode=${normalizedSiteCode ?? 'ALL'} ${formatAggregationError(error)}`,
      );
      return [];
    }

    const { rowDefinitions, sites, schedules } = shell;

    const filteredRows = rowDefinitions.filter((row) => {
      if (normalizedGroupId === undefined) {
        return true;
      }
      return row.groupId === normalizedGroupId;
    });

    const siteIds = [...new Set(filteredRows.map((row) => row.siteId))];
    const scopedSchedules = schedules.filter((schedule) => siteIds.includes(schedule.siteId));

    const currentPatrolTime = getPatrolTimeParts(new Date());
    const results: DashboardHourlyGuardStatusRow[] = [];

    for (const [siteId, siteRows] of this.groupRowsBySiteId(filteredRows)) {
      const lead = siteRows[0];
      const siteSchedules = scopedSchedules.filter((schedule) => schedule.siteId === siteId);

      this.logger.log(
        `GUARDSAFE_SITE_START ${summarizeRecord({
          siteId: lead.siteId,
          siteCode: lead.siteCode,
          siteName: lead.siteName,
        })} groupCount=${siteRows.length} scheduleCount=${siteSchedules.length}`,
      );

      try {
        const siteImageCount = await this.countPatrolImagesForSite(user, selectedDate, siteId);
        if (siteImageCount >= HIGH_VOLUME_IMAGE_THRESHOLD) {
          this.logger.log(
            `DASHBOARD_HIGH_VOLUME_SITE siteCode=${lead.siteCode} imageCount=${siteImageCount}`,
          );
        }

        const siteImages = await this.loadSiteImagesForGuardSafe(
          user,
          selectedDate,
          siteId,
          siteImageCount,
          normalizedHour,
          sites,
        );

        this.logGuardSafeSenderCount(siteImages, {
          date: selectedDate,
          siteCode: normalizedSiteCode,
          hour: normalizedHour,
        });

        const safetyBuckets = await this.buildHourlyBucketsForSite(
          user,
          selectedDate,
          siteId,
          siteRows,
          siteImageCount,
          sites,
        );

        for (const row of siteRows) {
          try {
            this.logger.log(
              `GUARDSAFE_GROUP_PROCESS ${summarizeRecord({
                siteId: row.siteId,
                siteCode: row.siteCode,
                siteName: row.siteName,
                groupId: row.groupId,
                groupName: row.groupName,
              })}`,
            );

            const cells = this.buildHourlyCells(row, safetyBuckets, selectedDate, currentPatrolTime);
            const hoursToRender = normalizedHour === undefined ? cells.map((cell) => cell.hour) : [normalizedHour];

            for (const targetHour of hoursToRender) {
              const cell = cells[targetHour];
              const activeSchedule = findActivePatrolSchedule(siteSchedules, row.siteId, selectedDate, targetHour);

              if (activeSchedule) {
                this.logger.log(
                  `GUARDSAFE_SCHEDULE_PROCESS ${summarizeRecord({
                    siteId: row.siteId,
                    siteCode: row.siteCode,
                    siteName: row.siteName,
                    groupId: row.groupId,
                    groupName: row.groupName,
                    scheduleId: activeSchedule.id,
                    scheduleName: activeSchedule.scheduleName,
                    expectedGuards: activeSchedule.expectedGuards,
                  })} hour=${targetHour}`,
                );
              }

              const guards = this.buildGuardStatusesForHour(
                row,
                targetHour,
                selectedDate,
                siteImages,
                siteSchedules,
              );

              results.push({
                date: selectedDate,
                siteId: row.siteId,
                siteCode: row.siteCode,
                siteName: row.siteName,
                groupId: row.groupId,
                groupName: row.groupName,
                hour: targetHour,
                siteStatus: cell.status,
                expectedGuards: guards,
              });
            }
          } catch (error) {
            this.logGuardsafeErrorRecord(row, normalizedHour, error);
          }
        }

        this.logger.log(
          `GUARDSAFE_SITE_SUCCESS ${summarizeRecord({
            siteId: lead.siteId,
            siteCode: lead.siteCode,
            siteName: lead.siteName,
          })} rowsBuilt=${siteRows.length}`,
        );
      } catch (error) {
        this.logger.error(
          `GUARDSAFE_SITE_ERROR ${summarizeRecord({
            siteId: lead.siteId,
            siteCode: lead.siteCode,
            siteName: lead.siteName,
          })} ${formatAggregationError(error)}`,
        );
      }
    }

    return results.sort((left, right) => {
      const siteOrder = safeLocaleCompare(left.siteCode, right.siteCode);
      if (siteOrder !== 0) {
        return siteOrder;
      }
      const groupOrder = safeLocaleCompare(left.groupName, right.groupName);
      if (groupOrder !== 0) {
        return groupOrder;
      }
      return left.hour - right.hour;
    });
  }

  async exportHourlySafetyCsv(user: AuthenticatedUser, date?: string): Promise<string> {
    const selectedDate = this.normalizeDate(date);
    const rows = await this.getHourlySafety(user, selectedDate);
    const header = [
      'Date',
      'Site Code',
      'Site Name',
      'Group Name',
      'Hour',
      'Status',
      'Safe Flag',
      'First Picture Time',
      'First Sender Name',
      'Total Pictures In Hour',
    ];
    const csvRows = rows.flatMap((row) =>
      row.hourlyCells.map((cell) => [
        selectedDate,
        row.siteCode,
        row.siteName,
        row.groupName ?? '',
        `${String(cell.hour).padStart(2, '0')}:00`,
        cell.status,
        cell.safeFlag ? 'true' : 'false',
        cell.firstPictureTime ?? '',
        cell.firstSenderName ?? '',
        String(cell.imageCount),
      ]),
    );

    return [header, ...csvRows]
      .map((line) => line.map((value) => this.escapeCsv(value)).join(','))
      .join('\n');
  }

  async exportHourlyGuardStatusCsv(
    user: AuthenticatedUser,
    date?: string,
    siteCode?: string,
    hour?: number,
    groupId?: string,
  ): Promise<string> {
    const rows = await this.getHourlyGuardStatus(user, date, siteCode, hour, groupId);
    const header = [
      'Date',
      'Site Code',
      'Site Name',
      'Group Name',
      'Hour',
      'Site Status',
      'Guard Name',
      'Guard Status',
      'First Picture Time',
      'Total Pictures In Hour',
      'Sender Number',
    ];
    const csvRows = rows.flatMap((row) => {
      if (row.expectedGuards.length === 0) {
        return [
          [
            row.date,
            row.siteCode,
            row.siteName,
            row.groupName ?? '',
            `${String(row.hour).padStart(2, '0')}:00`,
            row.siteStatus,
            '',
            '',
            '',
            '',
            '',
          ],
        ];
      }

      return row.expectedGuards.map((guard) => [
        row.date,
        row.siteCode,
        row.siteName,
        row.groupName ?? '',
        `${String(row.hour).padStart(2, '0')}:00`,
        row.siteStatus,
        guard.guardName,
        guard.status,
        guard.firstPictureTime ?? '',
        String(guard.totalPicturesInHour),
        guard.senderNumber ?? '',
      ]);
    });

    return [header, ...csvRows]
      .map((line) => line.map((value) => this.escapeCsv(value)).join(','))
      .join('\n');
  }

  private async loadSafetyShell(
    user: AuthenticatedUser,
    selectedDate: string,
    siteCode?: string,
  ): Promise<{
    sites: Site[];
    rowDefinitions: SafetyRowDefinition[];
    schedules: PatrolSchedule[];
  }> {
    const companyFilter = this.buildCompanyFilter(user);
    const normalizedSiteCode = siteCode?.trim();

    const sitesQuery = this.siteRepo
      .createQueryBuilder('site')
      .where('site.active = :active', { active: true })
      .orderBy('site.siteCode', 'ASC');

    if (companyFilter.companyId) {
      sitesQuery.andWhere('site.companyId = :companyId', companyFilter);
    }
    if (normalizedSiteCode) {
      sitesQuery.andWhere('site.siteCode = :siteCode', { siteCode: normalizedSiteCode });
    }

    const rawSites = await sitesQuery.getMany();
    const sitesWithGroups = await this.attachGroupsToSites(rawSites);
    const sites = sanitizeSitesForAggregation(sitesWithGroups);
    const rowDefinitions = this.buildRowDefinitionsFromSites(sites);
    const siteIds = sites.map((site) => site.id);
    let schedules: PatrolSchedule[] = [];

    try {
      schedules = dedupeSchedulesById(await this.loadPatrolSchedules(user, siteIds));
    } catch (error) {
      this.logger.error(
        `DASHBOARD_ERROR_RECORD stage=load-schedules-context date=${selectedDate} ${formatAggregationError(error)}`,
      );
    }

    this.auditAndLogDataIssues(sites, schedules, [], rowDefinitions);

    return {
      sites,
      rowDefinitions,
      schedules,
    };
  }

  private buildRowDefinitionsFromSites(sites: Site[]): SafetyRowDefinition[] {
    return this.buildRowDefinitions(sites, []);
  }

  private buildDegradedHourlyCells(
    selectedDate: string,
    currentPatrolTime: ReturnType<typeof getPatrolTimeParts>,
  ): HourlySafetyCell[] {
    return this.createEmptyBuckets().map((bucket) => {
      const pending = selectedDate === currentPatrolTime.date && bucket.hour >= currentPatrolTime.hour;
      return {
        hour: bucket.hour,
        status: pending ? 'Pending' : 'Missing',
        safeFlag: false,
        firstPictureTime: null,
        firstSenderName: null,
        firstImageId: null,
        imageCount: 0,
      };
    });
  }

  private async buildHourlyBucketsForSite(
    user: AuthenticatedUser,
    selectedDate: string,
    siteId: string,
    siteRows: SafetyRowDefinition[],
    siteImageCount: number,
    sites: Site[],
  ): Promise<Map<string, HourBucket[]>> {
    if (siteImageCount >= HIGH_VOLUME_IMAGE_THRESHOLD) {
      return this.buildHourlyBucketsFromSqlAggregates(siteId, selectedDate, siteRows);
    }

    const siteImages = await this.loadSiteImagesForAggregation(user, selectedDate, siteId, sites);
    return this.buildHourlyBuckets(siteImages, siteRows, selectedDate);
  }

  private async buildHourlyBucketsFromSqlAggregates(
    siteId: string,
    selectedDate: string,
    siteRows: SafetyRowDefinition[],
  ): Promise<Map<string, HourBucket[]>> {
    const aggregates = await this.loadSiteHourlySqlAggregates(siteId, selectedDate);
    const firstImagesByBucket = await this.loadFirstImagesForAggregates(siteId, selectedDate, aggregates);
    const bucketMap = buildHourlyBucketsFromAggregates(siteId, siteRows, aggregates, firstImagesByBucket);
    return bucketMap as Map<string, HourBucket[]>;
  }

  private async loadSiteHourlySqlAggregates(
    siteId: string,
    patrolDate: string,
  ): Promise<SiteHourlyImageAggregate[]> {
    const rawRows = await this.imageRepo
      .createQueryBuilder('image')
      .select('image.groupId', 'groupId')
      .addSelect('image.patrolHour', 'patrolHour')
      .addSelect('COUNT(*)', 'imageCount')
      .addSelect('MIN(image.sentAt)', 'firstSentAt')
      .where('image.siteId = :siteId', { siteId })
      .andWhere('image.patrolDate = :patrolDate', { patrolDate })
      .andWhere('image.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [...NON_COUNTABLE_IMAGE_STATUSES],
      })
      .groupBy('image.groupId')
      .addGroupBy('image.patrolHour')
      .getRawMany<{
        groupId: string | null;
        patrolHour: number | string;
        imageCount: number | string;
        firstSentAt: Date | string;
      }>();

    return rawRows.map((row) => ({
      groupId: row.groupId ?? null,
      patrolHour: parseAggregateHour(row.patrolHour),
      imageCount: parseAggregateCount(row.imageCount),
      firstSentAt: coerceSentAtToDate(row.firstSentAt),
    }));
  }

  private async loadFirstImagesForAggregates(
    siteId: string,
    patrolDate: string,
    aggregates: SiteHourlyImageAggregate[],
  ): Promise<Map<string, PatrolImage>> {
    const firstImages = new Map<string, PatrolImage>();
    const activeAggregates = aggregates.filter((aggregate) => aggregate.imageCount > 0);

    await Promise.all(
      activeAggregates.map(async (aggregate) => {
        const query = this.imageRepo
          .createQueryBuilder('image')
          .where('image.siteId = :siteId', { siteId })
          .andWhere('image.patrolDate = :patrolDate', { patrolDate })
          .andWhere('image.patrolHour = :patrolHour', { patrolHour: aggregate.patrolHour })
          .andWhere('image.status NOT IN (:...excludedStatuses)', {
            excludedStatuses: [...NON_COUNTABLE_IMAGE_STATUSES],
          })
          .orderBy('image.sentAt', 'ASC')
          .take(1);

        if (aggregate.groupId === null) {
          query.andWhere('image.groupId IS NULL');
        } else {
          query.andWhere('image.groupId = :groupId', { groupId: aggregate.groupId });
        }

        const image = await query.getOne();
        if (image) {
          image.sentAt = coerceSentAtToDate(image.sentAt);
          firstImages.set(buildAggregateBucketKey(aggregate.groupId, aggregate.patrolHour), image);
        }
      }),
    );

    return firstImages;
  }

  private async loadSiteImagesForAggregation(
    user: AuthenticatedUser,
    selectedDate: string,
    siteId: string,
    sites: Site[],
  ): Promise<PatrolImage[]> {
    const { startInclusive, endExclusive } = getPatrolDateUtcBounds(selectedDate);
    const rawImages = await this.loadImagesInDateRange(startInclusive, endExclusive, {
      siteId,
      order: 'ASC',
    });
    let images = this.attachPatrolImageRelations(rawImages, sites);
    images = images.filter((image) => isCountablePatrolImage(image));
    images = filterPatrolImagesForPatrolDate(images, selectedDate);
    images = dedupePatrolImagesForCount(images);
    return this.normalizeImagesForAggregation(images);
  }

  private async loadSiteImagesForGuardSafe(
    user: AuthenticatedUser,
    selectedDate: string,
    siteId: string,
    siteImageCount: number,
    hour: number | undefined,
    sites: Site[],
  ): Promise<PatrolImage[]> {
    if (siteImageCount >= HIGH_VOLUME_IMAGE_THRESHOLD) {
      if (hour !== undefined) {
        return this.loadSiteImagesForHour(user, selectedDate, siteId, hour, sites);
      }

      const hourlyImages: PatrolImage[] = [];
      for (let patrolHour = 0; patrolHour < 24; patrolHour += 1) {
        const hourImages = await this.loadSiteImagesForHour(
          user,
          selectedDate,
          siteId,
          patrolHour,
          sites,
        );
        hourlyImages.push(...hourImages);
      }
      return dedupePatrolImagesForCount(hourlyImages);
    }

    return this.loadSiteImagesForAggregation(user, selectedDate, siteId, sites);
  }

  private async loadSiteImagesForHour(
    user: AuthenticatedUser,
    selectedDate: string,
    siteId: string,
    patrolHour: number,
    sites: Site[],
  ): Promise<PatrolImage[]> {
    const rawImages = await this.imageRepo
      .createQueryBuilder('image')
      .where('image.siteId = :siteId', { siteId })
      .andWhere('image.patrolDate = :patrolDate', { patrolDate: selectedDate })
      .andWhere('image.patrolHour = :patrolHour', { patrolHour })
      .andWhere('image.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [...NON_COUNTABLE_IMAGE_STATUSES],
      })
      .orderBy('image.sentAt', 'ASC')
      .getMany();

    let images = this.attachPatrolImageRelations(rawImages, sites);
    images = filterPatrolImagesForPatrolDate(images, selectedDate);
    images = dedupePatrolImagesForCount(images);
    return this.normalizeImagesForAggregation(images);
  }

  private async countPatrolImagesForDate(user: AuthenticatedUser, selectedDate: string): Promise<number> {
    const companyFilter = this.buildCompanyFilter(user);
    const query = this.imageRepo
      .createQueryBuilder('image')
      .where('image.patrolDate = :patrolDate', { patrolDate: selectedDate })
      .andWhere('image.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [...NON_COUNTABLE_IMAGE_STATUSES],
      });

    if (companyFilter.companyId) {
      query.andWhere(
        'image.siteId IN (SELECT scopedSite.id FROM sites scopedSite WHERE scopedSite.companyId = :companyId AND scopedSite.active = true)',
        { companyId: companyFilter.companyId },
      );
    }

    return query.getCount();
  }

  private async countPatrolImagesForSite(
    user: AuthenticatedUser,
    selectedDate: string,
    siteId: string,
  ): Promise<number> {
    return this.imageRepo
      .createQueryBuilder('image')
      .where('image.siteId = :siteId', { siteId })
      .andWhere('image.patrolDate = :patrolDate', { patrolDate: selectedDate })
      .andWhere('image.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [...NON_COUNTABLE_IMAGE_STATUSES],
      })
      .getCount();
  }

  private async countPatrolImagesBySiteForDate(
    user: AuthenticatedUser,
    selectedDate: string,
  ): Promise<Map<string, number>> {
    const companyFilter = this.buildCompanyFilter(user);
    const query = this.imageRepo
      .createQueryBuilder('image')
      .select('image.siteId', 'siteId')
      .addSelect('COUNT(*)', 'imageCount')
      .where('image.patrolDate = :patrolDate', { patrolDate: selectedDate })
      .andWhere('image.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [...NON_COUNTABLE_IMAGE_STATUSES],
      })
      .groupBy('image.siteId');

    if (companyFilter.companyId) {
      query.andWhere(
        'image.siteId IN (SELECT scopedSite.id FROM sites scopedSite WHERE scopedSite.companyId = :companyId AND scopedSite.active = true)',
        { companyId: companyFilter.companyId },
      );
    }

    const rows = await query.getRawMany<{ siteId: string; imageCount: number | string }>();
    return new Map(rows.map((row) => [row.siteId, parseAggregateCount(row.imageCount)]));
  }

  private async loadLatestImageAtBySiteForDate(
    user: AuthenticatedUser,
    selectedDate: string,
  ): Promise<Map<string, string>> {
    const companyFilter = this.buildCompanyFilter(user);
    const query = this.imageRepo
      .createQueryBuilder('image')
      .select('image.siteId', 'siteId')
      .addSelect('MAX(image.sentAt)', 'latestSentAt')
      .where('image.patrolDate = :patrolDate', { patrolDate: selectedDate })
      .andWhere('image.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [...NON_COUNTABLE_IMAGE_STATUSES],
      })
      .groupBy('image.siteId');

    if (companyFilter.companyId) {
      query.andWhere(
        'image.siteId IN (SELECT scopedSite.id FROM sites scopedSite WHERE scopedSite.companyId = :companyId AND scopedSite.active = true)',
        { companyId: companyFilter.companyId },
      );
    }

    const rows = await query.getRawMany<{ siteId: string; latestSentAt: Date | string }>();
    return new Map(
      rows.map((row) => [row.siteId, coerceSentAtToDate(row.latestSentAt).toISOString()]),
    );
  }

  private async loadRecentPatrolImages(
    user: AuthenticatedUser,
    selectedDate: string,
    limit: number,
  ): Promise<DashboardOverview['recentImages']> {
    const companyFilter = this.buildCompanyFilter(user);
    const { startInclusive, endExclusive } = getPatrolDateUtcBounds(selectedDate);
    const query = this.imageRepo
      .createQueryBuilder('image')
      .innerJoin('image.site', 'site')
      .select([
        'image.id',
        'image.sentAt',
        'image.senderName',
        'site.siteCode',
      ])
      .where('image.sentAt >= :startInclusive AND image.sentAt < :endExclusive', {
        startInclusive,
        endExclusive,
      })
      .andWhere('image.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [...NON_COUNTABLE_IMAGE_STATUSES],
      })
      .orderBy('image.sentAt', 'DESC')
      .take(limit);

    if (companyFilter.companyId) {
      query.andWhere('site.companyId = :companyId', { companyId: companyFilter.companyId });
    }

    const images = await query.getMany();
    return images.map((image) => ({
      id: image.id,
      siteCode: image.site?.siteCode ?? 'UNKNOWN',
      sentAt: coerceSentAtToDate(image.sentAt).toISOString(),
      status: 'Safe',
      senderName: image.senderName,
    }));
  }


  private groupRowsBySiteId(rows: SafetyRowDefinition[]): Map<string, SafetyRowDefinition[]> {
    const grouped = new Map<string, SafetyRowDefinition[]>();

    for (const row of rows) {
      const existing = grouped.get(row.siteId) ?? [];
      existing.push(row);
      grouped.set(row.siteId, existing);
    }

    return grouped;
  }

  private auditAndLogDataIssues(
    sites: Site[],
    schedules: PatrolSchedule[],
    images: PatrolImage[],
    rowDefinitions: SafetyRowDefinition[],
  ): void {
    const issues = auditAggregationData({
      sites,
      schedules,
      images,
      rowDefinitions,
    });

    for (const issue of issues) {
      this.logger.warn(`DASHBOARD_DATA_AUDIT code=${issue.code} ${issue.detail}`);
    }
  }

  private normalizeImagesForAggregation(images: PatrolImage[]): PatrolImage[] {
    const normalized: PatrolImage[] = [];

    for (const image of images) {
      try {
        const nextImage = image;
        nextImage.sentAt = coerceSentAtToDate(image.sentAt);
        normalized.push(nextImage);
      } catch (error) {
        this.logger.warn(
          `DASHBOARD_ERROR_RECORD stage=normalize-image imageId=${image.id} siteId=${image.siteId} groupId=${image.groupId ?? 'site'} ${formatAggregationError(error)}`,
        );
      }
    }

    return normalized;
  }

  private logDashboardErrorRecord(
    stage: string,
    row: SafetyRowDefinition,
    error: unknown,
  ): void {
    this.logger.error(
      `DASHBOARD_ERROR_RECORD stage=${stage} ${summarizeRecord(row)} ${formatAggregationError(error)}`,
    );
  }

  private logGuardsafeErrorRecord(
    row: SafetyRowDefinition,
    hour: number | undefined,
    error: unknown,
  ): void {
    this.logger.error(
      `GUARDSAFE_ERROR_RECORD ${summarizeRecord(row)} hour=${hour ?? 'ALL'} ${formatAggregationError(error)}`,
    );
  }

  private logGuardSafeSenderCount(
    images: PatrolImage[],
    context: { date: string; siteCode?: string; hour?: number },
  ): void {
    const scopedImages = images.filter((image) => {
      if (!isCountablePatrolImage(image)) {
        return false;
      }
      if (context.hour === undefined) {
        return true;
      }
      return imagePatrolHourFromSentAt(image.sentAt) === context.hour;
    });

    const uniqueRepresentatives: PatrolImage[] = [];

    for (const image of scopedImages) {
      const overlapping = uniqueRepresentatives.find((existing) =>
        senderIdentityKeysOverlap(
          {
            senderExternalId: existing.senderExternalId,
            senderNumber: existing.senderNumber,
          },
          {
            senderExternalId: image.senderExternalId,
            senderNumber: image.senderNumber,
          },
        ),
      );

      if (!overlapping) {
        uniqueRepresentatives.push(image);
      }
    }

    this.logger.log(
      `GUARDSAFE_SENDER_COUNT date=${context.date} siteCode=${context.siteCode ?? 'ALL'} hour=${context.hour ?? 'ALL'} count=${uniqueRepresentatives.length}`,
    );

    for (const image of uniqueRepresentatives) {
      this.logger.log(
        `GUARDSAFE_SENDER_COUNT imageId=${image.id} siteId=${image.siteId} senderExternalId=${image.senderExternalId ?? ''} senderNumber=${image.senderNumber ?? ''} senderName=${image.senderName ?? ''}`,
      );
    }
  }

  private resolveImagePatrolDate(image: PatrolImage): string {
    return getPatrolTimeParts(image.sentAt).date;
  }

  private resolveImagePatrolHour(image: PatrolImage): number {
    return imagePatrolHourFromSentAt(image.sentAt);
  }

  private imageMatchesRow(image: PatrolImage, row: SafetyRowDefinition): boolean {
    if (image.siteId !== row.siteId) {
      return false;
    }

    const imageGroupId = image.groupId ?? null;
    const rowGroupId = row.groupId ?? null;

    if (rowGroupId === null) {
      return imageGroupId === null;
    }

    return rowGroupId === imageGroupId;
  }

  private aggregateHourlySafetyBySite(rows: DashboardHourlySafetyRow[]): DashboardHourlySafetyRow[] {
    const rowsBySite = rows.reduce((map, row) => {
      const existing = map.get(row.siteId) ?? [];
      existing.push(row);
      map.set(row.siteId, existing);
      return map;
    }, new Map<string, DashboardHourlySafetyRow[]>());

    const aggregated: DashboardHourlySafetyRow[] = [];

    for (const siteRows of rowsBySite.values()) {
      if (siteRows.length === 0) {
        continue;
      }

      const firstRow = siteRows[0];

      try {
        aggregated.push({
          siteId: firstRow.siteId,
          siteCode: firstRow.siteCode,
          siteName: firstRow.siteName,
          groupId: null,
          groupName: null,
          hourlyCells: this.mergeHourlyCellsAcrossRows(siteRows.map((row) => row.hourlyCells)),
        });
      } catch (error) {
        this.logger.error(
          `DASHBOARD_SITE_ERROR ${summarizeRecord({
            siteId: firstRow.siteId,
            siteCode: firstRow.siteCode,
            siteName: firstRow.siteName,
          })} stage=aggregate ${formatAggregationError(error)}`,
        );
      }
    }

    return aggregated;
  }

  private mergeHourlyCellsAcrossRows(allCells: HourlySafetyCell[][]): HourlySafetyCell[] {
    const merged = this.createEmptyHourlyCells();

    for (const rowCells of allCells) {
      for (const cell of rowCells) {
        const target = merged[cell.hour];

        if (cell.status === 'Safe') {
          if (target.status !== 'Safe') {
            target.status = 'Safe';
            target.safeFlag = true;
            target.firstPictureTime = cell.firstPictureTime;
            target.firstSenderName = cell.firstSenderName;
            target.firstImageId = cell.firstImageId;
            target.imageCount = cell.imageCount;
            continue;
          }

          target.imageCount += cell.imageCount;
          if (
            cell.firstPictureTime &&
            (!target.firstPictureTime || cell.firstPictureTime < target.firstPictureTime)
          ) {
            target.firstPictureTime = cell.firstPictureTime;
            target.firstSenderName = cell.firstSenderName;
            target.firstImageId = cell.firstImageId;
          }
          continue;
        }

        if (target.status === 'Safe') {
          continue;
        }

        if (cell.status === 'Pending' && target.status === 'Missing') {
          target.status = 'Pending';
          target.safeFlag = false;
        }
      }
    }

    return merged;
  }

  private createEmptyHourlyCells(): HourlySafetyCell[] {
    return Array.from({ length: 24 }, (_, hour) => ({
      hour,
      status: 'Missing',
      safeFlag: false,
      firstPictureTime: null,
      firstSenderName: null,
      firstImageId: null,
      imageCount: 0,
    }));
  }

  private async attachGroupsToSites(sites: Site[]): Promise<Site[]> {
    if (sites.length === 0) {
      return [];
    }

    const siteIds = sites.map((site) => site.id);
    const groups = await queryWithChunkedInClause(siteIds, {
      column: 'siteId',
      onChunking: (details) =>
        this.logSqliteExpressionDepthPrevented('load-active-groups', details),
      queryChunk: async (chunkSiteIds) =>
        this.groupRepo
          .createQueryBuilder('group')
          .where('group.active = true')
          .andWhere('group.siteId IN (:...siteIds)', { siteIds: chunkSiteIds })
          .orderBy('group.groupName', 'ASC')
          .getMany(),
    });

    const groupsBySiteId = new Map<string, PatrolGroup[]>();
    for (const group of groups) {
      const existing = groupsBySiteId.get(group.siteId) ?? [];
      existing.push(group);
      groupsBySiteId.set(group.siteId, existing);
    }

    return sites.map((site) => ({
      ...site,
      groups: groupsBySiteId.get(site.id) ?? [],
    }));
  }

  private attachPatrolImageRelations(images: PatrolImage[], sites: Site[]): PatrolImage[] {
    const siteById = new Map(sites.map((site) => [site.id, site]));
    const groupById = new Map<string, PatrolGroup>();

    for (const site of sites) {
      for (const group of site.groups ?? []) {
        groupById.set(group.id, group);
      }
    }

    return images.map((image) => {
      const site = siteById.get(image.siteId);
      const group = image.groupId ? groupById.get(image.groupId) : undefined;
      return Object.assign(image, { site, group });
    });
  }

  private async loadImagesInDateRange(
    startInclusive: Date,
    endExclusive: Date,
    options: {
      companyId?: string;
      siteId?: string;
      siteIds?: string[];
      order?: 'ASC' | 'DESC';
    },
  ): Promise<PatrolImage[]> {
    const order = options.order ?? 'ASC';

    if (options.siteId) {
      return this.imageRepo
        .createQueryBuilder('image')
        .where('image.sentAt >= :startInclusive AND image.sentAt < :endExclusive', {
          startInclusive,
          endExclusive,
        })
        .andWhere('image.siteId = :siteId', { siteId: options.siteId })
        .orderBy('image.sentAt', order)
        .getMany();
    }

    if (options.siteIds?.length) {
      const images = await queryWithChunkedInClause(options.siteIds, {
        column: 'siteId',
        onChunking: (details) =>
          this.logSqliteExpressionDepthPrevented('load-images-in-date-range', details),
        queryChunk: async (chunkSiteIds) =>
          this.imageRepo
            .createQueryBuilder('image')
            .where('image.sentAt >= :startInclusive AND image.sentAt < :endExclusive', {
              startInclusive,
              endExclusive,
            })
            .andWhere('image.siteId IN (:...siteIds)', { siteIds: chunkSiteIds })
            .orderBy('image.sentAt', order)
            .getMany(),
      });

      return this.sortPatrolImagesBySentAt(images, order);
    }

    const query = this.imageRepo
      .createQueryBuilder('image')
      .where('image.sentAt >= :startInclusive AND image.sentAt < :endExclusive', {
        startInclusive,
        endExclusive,
      })
      .orderBy('image.sentAt', order);

    if (options.companyId) {
      query.andWhere(
        'image.siteId IN (SELECT scopedSite.id FROM sites scopedSite WHERE scopedSite.companyId = :companyId AND scopedSite.active = true)',
        { companyId: options.companyId },
      );
    }

    return query.getMany();
  }

  private sortPatrolImagesBySentAt(images: PatrolImage[], order: 'ASC' | 'DESC'): PatrolImage[] {
    return [...images].sort((left, right) => {
      const delta = left.sentAt.getTime() - right.sentAt.getTime();
      return order === 'ASC' ? delta : -delta;
    });
  }

  private logSqliteExpressionDepthPrevented(
    operation: string,
    details: { column: string; idCount: number; chunkCount: number; chunkSize: number },
  ): void {
    this.logger.log(
      `SQLITE_EXPRESSION_DEPTH_PREVENTED operation=${operation} column=${details.column} idCount=${details.idCount} chunkCount=${details.chunkCount} chunkSize=${details.chunkSize}`,
    );
  }

  private async loadPatrolSchedules(
    user: AuthenticatedUser,
    siteIds: string[],
  ): Promise<PatrolSchedule[]> {
    if (siteIds.length === 0) {
      return [];
    }

    const companyFilter = this.buildCompanyFilter(user);
    const rawSchedules = await queryWithChunkedInClause(siteIds, {
      column: 'siteId',
      onChunking: (details) =>
        this.logSqliteExpressionDepthPrevented('load-patrol-schedules', details),
      queryChunk: async (chunkSiteIds) => {
        const query = this.patrolScheduleRepo
          .createQueryBuilder('schedule')
          .innerJoinAndSelect('schedule.site', 'site')
          .where('schedule.active = true')
          .andWhere('schedule.siteId IN (:...siteIds)', { siteIds: chunkSiteIds });

        if (companyFilter.companyId) {
          query.andWhere('site.companyId = :companyId', companyFilter);
        }

        return query.getMany();
      },
    });
    const schedules: PatrolSchedule[] = [];

    for (const schedule of rawSchedules) {
      if (!schedule?.id) {
        this.logger.warn(
          `DASHBOARD_DATA_AUDIT code=null-schedule siteId=${schedule?.siteId ?? 'none'} scheduleName=${schedule?.scheduleName ?? 'none'}`,
        );
        continue;
      }

      try {
        schedules.push(normalizeScheduleRecord(schedule));
      } catch (error) {
        this.logger.warn(
          `DASHBOARD_DATA_AUDIT code=invalid-schedule scheduleId=${schedule.id} siteId=${schedule.siteId} ${formatAggregationError(error)}`,
        );
      }
    }

    return schedules;
  }

  private async loadGuardSenderMappings(
    user: AuthenticatedUser,
    guardIds: string[],
  ): Promise<GuardSenderMapping[]> {
    if (guardIds.length === 0) {
      return [];
    }

    const companyFilter = this.buildCompanyFilter(user);
    return queryWithChunkedInClause(guardIds, {
      column: 'guardId',
      onChunking: (details) =>
        this.logSqliteExpressionDepthPrevented('load-guard-sender-mappings', details),
      queryChunk: async (chunkGuardIds) => {
        const query = this.guardSenderMappingRepo
          .createQueryBuilder('mapping')
          .innerJoinAndSelect('mapping.guard', 'guard')
          .where('mapping.active = true')
          .andWhere('mapping.guardId IN (:...guardIds)', { guardIds: chunkGuardIds });

        if (companyFilter.companyId) {
          query.andWhere('guard.companyId = :companyId', companyFilter);
        }

        return query.getMany();
      },
    });
  }

  private buildGuardStatusesForHour(
    row: SafetyRowDefinition,
    hour: number,
    selectedDate: string,
    images: PatrolImage[],
    schedules: PatrolSchedule[],
  ): HourlyGuardStatusEntry[] {
    const normalizedSchedules = dedupeSchedulesById(schedules);
    const schedule = findActivePatrolSchedule(normalizedSchedules, row.siteId, selectedDate, hour);

    if (!schedule) {
      return this.buildObservedGuardStatusesForHour(row, hour, images, [], new Map());
    }

    const observedRepresentatives = this.collectObservedRepresentativesForHour(row, hour, images);
    const expectedCount = Math.max(1, Number(schedule.expectedGuards) || 1);
    const scheduleLabel = schedule.scheduleName?.trim() || 'Shift';
    const scheduleId = schedule.id ?? 'unknown-schedule';
    const expectedGuards: HourlyGuardStatusEntry[] = [];

    for (let index = 0; index < expectedCount; index += 1) {
      const image = observedRepresentatives[index];

      if (image) {
        const senderNumber = image.senderNumber?.trim() || null;
        const guardName =
          stripSourceFromSenderName(image.senderName) || senderNumber || `Guard ${index + 1}`;
        const mergeKey =
          buildSiteSenderMergeKey(row.siteId, {
            senderExternalId: image.senderExternalId,
            senderNumber: image.senderNumber,
          }) ?? `slot-${index}`;

        expectedGuards.push({
          guardId: `schedule:${scheduleId}:${index}:${mergeKey}`,
          guardName,
          status: 'Reported',
          firstPictureTime: coerceSentAtToDate(image.sentAt).toISOString(),
          totalPicturesInHour: this.countImagesForSenderInHour(row, hour, images, image),
          senderNumber,
        });
        continue;
      }

      expectedGuards.push({
        guardId: `schedule:${scheduleId}:${index}`,
        guardName: `${scheduleLabel} · Guard ${index + 1}`,
        status: 'Missing',
        firstPictureTime: null,
        totalPicturesInHour: 0,
        senderNumber: null,
      });
    }

    const extraObserved = observedRepresentatives
      .slice(expectedCount)
      .map((image) => this.buildObservedGuardEntry(row, hour, images, image));

    return [...expectedGuards, ...extraObserved].sort((left, right) =>
      safeLocaleCompare(left.guardName, right.guardName),
    );
  }

  private collectObservedRepresentativesForHour(
    row: SafetyRowDefinition,
    hour: number,
    images: PatrolImage[],
  ): PatrolImage[] {
    const observedRepresentatives: PatrolImage[] = [];

    for (const image of images) {
      if (!this.imageMatchesRow(image, row) || this.resolveImagePatrolHour(image) !== hour) {
        continue;
      }
      if (!isCountablePatrolImage(image)) {
        continue;
      }

      const identity = {
        senderExternalId: image.senderExternalId,
        senderNumber: image.senderNumber,
      };
      const overlappingIndex = observedRepresentatives.findIndex((existing) =>
        senderIdentityKeysOverlap(
          {
            senderExternalId: existing.senderExternalId,
            senderNumber: existing.senderNumber,
          },
          identity,
        ),
      );

      if (overlappingIndex >= 0) {
        const existing = observedRepresentatives[overlappingIndex];
        if (image.sentAt < existing.sentAt) {
          observedRepresentatives[overlappingIndex] = image;
        }
        continue;
      }

      observedRepresentatives.push(image);
    }

    return observedRepresentatives.sort((left, right) => left.sentAt.getTime() - right.sentAt.getTime());
  }

  private countImagesForSenderInHour(
    row: SafetyRowDefinition,
    hour: number,
    images: PatrolImage[],
    representative: PatrolImage,
  ): number {
    return images.filter((candidate) => {
      if (!this.imageMatchesRow(candidate, row) || this.resolveImagePatrolHour(candidate) !== hour) {
        return false;
      }
      if (!isCountablePatrolImage(candidate)) {
        return false;
      }

      return senderIdentityKeysOverlap(
        {
          senderExternalId: representative.senderExternalId,
          senderNumber: representative.senderNumber,
        },
        {
          senderExternalId: candidate.senderExternalId,
          senderNumber: candidate.senderNumber,
        },
      );
    }).length;
  }

  private buildObservedGuardEntry(
    row: SafetyRowDefinition,
    hour: number,
    images: PatrolImage[],
    image: PatrolImage,
  ): HourlyGuardStatusEntry {
    const senderNumber = image.senderNumber?.trim() || null;
    const guardName = stripSourceFromSenderName(image.senderName) || senderNumber || 'Unknown sender';
    const observedKey =
      buildSiteSenderMergeKey(row.siteId, {
        senderExternalId: image.senderExternalId,
        senderNumber: image.senderNumber,
      }) ?? mergeKeyFromImage(image);

    return {
      guardId: `observed:${observedKey}`,
      guardName,
      status: 'Reported',
      firstPictureTime: coerceSentAtToDate(image.sentAt).toISOString(),
      totalPicturesInHour: this.countImagesForSenderInHour(row, hour, images, image),
      senderNumber,
    };
  }

  private buildObservedGuardStatusesForHour(
    row: SafetyRowDefinition,
    hour: number,
    images: PatrolImage[],
    assignments: ShiftGuardAssignment[],
    mappingsByGuardId: Map<string, GuardSenderMapping[]>,
  ): HourlyGuardStatusEntry[] {
    const observedRepresentatives: PatrolImage[] = [];

    for (const image of images) {
      if (!this.imageMatchesRow(image, row) || this.resolveImagePatrolHour(image) !== hour) {
        continue;
      }
      if (!isCountablePatrolImage(image)) {
        continue;
      }

      const identity = {
        senderExternalId: image.senderExternalId,
        senderNumber: image.senderNumber,
      };
      const mergeKey = buildSiteSenderMergeKey(row.siteId, identity);
      if (!mergeKey) {
        continue;
      }

      if (this.isSenderCoveredByExpectedGuards(image, assignments, mappingsByGuardId)) {
        continue;
      }

      const overlappingIndex = observedRepresentatives.findIndex((existing) =>
        senderIdentityKeysOverlap(
          {
            senderExternalId: existing.senderExternalId,
            senderNumber: existing.senderNumber,
          },
          identity,
        ),
      );

      if (overlappingIndex >= 0) {
        const existing = observedRepresentatives[overlappingIndex];
        if (image.sentAt < existing.sentAt) {
          observedRepresentatives[overlappingIndex] = image;
        }
        continue;
      }

      observedRepresentatives.push(image);
    }

    return observedRepresentatives.map((image) => {
      const senderNumber = image.senderNumber?.trim() || null;
      const guardName =
        stripSourceFromSenderName(image.senderName) || senderNumber || 'Unknown sender';
      const observedKey =
        buildSiteSenderMergeKey(row.siteId, {
          senderExternalId: image.senderExternalId,
          senderNumber: image.senderNumber,
        }) ?? mergeKeyFromImage(image);

      return {
        guardId: `observed:${observedKey}`,
        guardName,
        status: 'Reported' as HourlyGuardStatus,
        firstPictureTime: coerceSentAtToDate(image.sentAt).toISOString(),
        totalPicturesInHour: images.filter((candidate) => {
          if (!this.imageMatchesRow(candidate, row) || this.resolveImagePatrolHour(candidate) !== hour) {
            return false;
          }
          if (!isCountablePatrolImage(candidate)) {
            return false;
          }
          return senderIdentityKeysOverlap(
            {
              senderExternalId: image.senderExternalId,
              senderNumber: image.senderNumber,
            },
            {
              senderExternalId: candidate.senderExternalId,
              senderNumber: candidate.senderNumber,
            },
          );
        }).length,
        senderNumber,
      };
    });
  }

  private isSenderCoveredByExpectedGuards(
    image: PatrolImage,
    assignments: ShiftGuardAssignment[],
    mappingsByGuardId: Map<string, GuardSenderMapping[]>,
  ): boolean {
    const imageIdentity = {
      senderExternalId: image.senderExternalId,
      senderNumber: image.senderNumber,
    };

    for (const assignment of assignments) {
      const mappings = mappingsByGuardId.get(assignment.guardId) ?? [];
      for (const mapping of mappings) {
        if (
          senderIdentityKeysOverlap(imageIdentity, {
            senderNumber: mapping.senderNumber,
          })
        ) {
          return true;
        }
      }
    }

    return false;
  }

  private collectGuardHourMatches(
    row: SafetyRowDefinition,
    hour: number,
    images: PatrolImage[],
    mappings: GuardSenderMapping[],
  ): {
    guardId: string;
    senderNumber: string | null;
    count: number;
    firstImage: PatrolImage | null;
  } {
    const matchingImages = images.filter((image) => {
      if (!this.imageMatchesRow(image, row) || this.resolveImagePatrolHour(image) !== hour) {
        return false;
      }
      if (!isCountablePatrolImage(image)) {
        return false;
      }

      return mappings.some((mapping) =>
        senderIdentityKeysOverlap(
          {
            senderExternalId: image.senderExternalId,
            senderNumber: image.senderNumber,
          },
          { senderNumber: mapping.senderNumber },
        ),
      );
    });

    const firstImage = matchingImages.reduce<PatrolImage | null>((current, candidate) => {
      if (!current || candidate.sentAt < current.sentAt) {
        return candidate;
      }
      return current;
    }, null);

    return {
      guardId: mappings[0]?.guardId ?? '',
      senderNumber: firstImage?.senderNumber ?? mappings[0]?.senderNumber ?? null,
      count: matchingImages.length,
      firstImage,
    };
  }

  private buildCompanyFilter(user: AuthenticatedUser): { companyId?: string } {
    if (user.role === UserRole.ADMIN) {
      return {};
    }
    return user.companyId ? { companyId: user.companyId } : {};
  }

  private normalizeDate(date?: string): string {
    const selectedDate = date?.trim() || getPatrolTimeParts(new Date()).date;
    const parsed = new Date(`${selectedDate}T00:00:00.000Z`);

    if (Number.isNaN(parsed.getTime())) {
      throw new Error('date must use YYYY-MM-DD format');
    }

    return selectedDate;
  }

  private normalizeHour(hour?: number): number | undefined {
    if (hour === undefined || hour === null) {
      return undefined;
    }
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      throw new Error('hour must be an integer between 0 and 23');
    }
    return hour;
  }

  private buildHourlyTotals(rows: DashboardHourlySafetyRow[]): Record<string, number> {
    const cells = rows.flatMap((row) => row.hourlyCells);
    return {
      total: cells.length,
      Safe: cells.filter((cell) => cell.status === 'Safe').length,
      Missing: cells.filter((cell) => cell.status === 'Missing').length,
      Pending: cells.filter((cell) => cell.status === 'Pending').length,
    };
  }

  private buildRowDefinitions(sites: Site[], images: PatrolImage[]): SafetyRowDefinition[] {
    const definitions = new Map<string, SafetyRowDefinition>();

    for (const site of sites) {
      const activeGroups = (site.groups ?? []).filter((group) => group.active !== false);
      const siteKey = this.buildRowKey(site.id, null);
      definitions.set(siteKey, this.createRowDefinition(site, null));

      for (const group of activeGroups) {
        const key = this.buildRowKey(site.id, group.id);
        definitions.set(key, this.createRowDefinition(site, group));
      }
    }

    for (const image of images) {
      if (!image.site) {
        continue;
      }
      const key = this.buildRowKey(image.siteId, image.groupId ?? null);
      if (!definitions.has(key)) {
        definitions.set(key, this.createRowDefinition(image.site, image.group ?? null));
      }
    }

    return [...definitions.values()].sort((left, right) => {
      const siteOrder = safeLocaleCompare(left.siteCode, right.siteCode);
      if (siteOrder !== 0) {
        return siteOrder;
      }
      return safeLocaleCompare(left.groupName, right.groupName);
    });
  }

  private createRowDefinition(site: Site, group: PatrolGroup | null): SafetyRowDefinition {
    return {
      siteId: site.id,
      siteCode: site.siteCode?.trim() || 'UNKNOWN',
      siteName: site.siteName?.trim() || site.siteCode?.trim() || 'Unknown site',
      clientName: site.clientName,
      groupId: group?.id ?? null,
      groupName: group?.groupName?.trim() ?? null,
    };
  }

  private buildHourlyBuckets(
    images: PatrolImage[],
    rows: SafetyRowDefinition[],
    selectedDate: string,
  ): Map<string, HourBucket[]> {
    const buckets = new Map<string, HourBucket[]>();

    for (const image of images) {
      if (!isCountablePatrolImage(image)) {
        continue;
      }
      if (this.resolveImagePatrolDate(image) !== selectedDate) {
        continue;
      }

      const patrolHour = this.resolveImagePatrolHour(image);

      for (const row of rows) {
        if (!this.imageMatchesRow(image, row)) {
          continue;
        }

        const rowKey = this.buildRowKey(row.siteId, row.groupId);
        const hourBuckets = buckets.get(rowKey) ?? this.createEmptyBuckets();
        const bucket = hourBuckets[patrolHour];
        bucket.count += 1;

        if (!bucket.firstImage || image.sentAt < bucket.firstImage.sentAt) {
          bucket.firstImage = image;
        }

        buckets.set(rowKey, hourBuckets);
      }
    }

    return buckets;
  }

  private buildHourlyCells(
    row: SafetyRowDefinition,
    buckets: Map<string, HourBucket[]>,
    selectedDate: string,
    currentPatrolTime: ReturnType<typeof getPatrolTimeParts>,
  ): HourlySafetyCell[] {
    const rowKey = this.buildRowKey(row.siteId, row.groupId);
    const hourBuckets = buckets.get(rowKey) ?? this.createEmptyBuckets();

    return hourBuckets.map((bucket) => {
      const pending = selectedDate === currentPatrolTime.date && bucket.hour >= currentPatrolTime.hour;

      if (bucket.count >= 1) {
        return {
          hour: bucket.hour,
          status: 'Safe',
          safeFlag: true,
          firstPictureTime: bucket.firstImage ? coerceSentAtToDate(bucket.firstImage.sentAt).toISOString() : null,
          firstSenderName: bucket.firstImage?.senderName ?? null,
          firstImageId: bucket.firstImage?.id ?? null,
          imageCount: bucket.count,
        };
      }

      return {
        hour: bucket.hour,
        status: pending ? 'Pending' : 'Missing',
        safeFlag: false,
        firstPictureTime: null,
        firstSenderName: null,
        firstImageId: null,
        imageCount: 0,
      };
    });
  }

  private createEmptyBuckets(): HourBucket[] {
    return Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: 0,
      firstImage: null,
    }));
  }

  private buildRowKey(siteId: string, groupId: string | null): string {
    return `${siteId}::${groupId ?? 'site'}`;
  }

  private guardName(guard: User | undefined): string {
    if (!guard) {
      return 'Unknown guard';
    }
    return `${guard.firstName} ${guard.lastName}`.trim();
  }

  private groupByGuardId(mappings: GuardSenderMapping[]): Map<string, GuardSenderMapping[]> {
    return mappings.reduce((map, mapping) => {
      const existing = map.get(mapping.guardId) ?? [];
      existing.push(mapping);
      map.set(mapping.guardId, existing);
      return map;
    }, new Map<string, GuardSenderMapping[]>());
  }

  private escapeCsv(value: string | number | boolean): string {
    const normalized = String(value ?? '');
    if (!/[,"\n]/.test(normalized)) {
      return normalized;
    }
    return `"${normalized.replace(/"/g, '""')}"`;
  }

  private groupBySite<T extends { siteId: string }>(rows: T[]): Map<string, T[]> {
    return rows.reduce((map, row) => {
      const existing = map.get(row.siteId) ?? [];
      existing.push(row);
      map.set(row.siteId, existing);
      return map;
    }, new Map<string, T[]>());
  }
}

function mergeKeyFromImage(image: PatrolImage): string {
  return (
    canonicalSenderKey({
      senderExternalId: image.senderExternalId,
      senderNumber: image.senderNumber,
    }) ?? image.id
  );
}
