import { normalizeActiveDays } from '@/common/utils/patrol-schedule.util';
import { PatrolSchedule } from '@/patrol-schedules/entities/patrol-schedule.entity';
import { PatrolGroup } from '@/patrol-groups/entities/patrol-group.entity';
import { Site } from '@/sites/entities/site.entity';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';

export function normalizeScheduleRecord(schedule: PatrolSchedule): PatrolSchedule {
  return {
    ...schedule,
    scheduleName: schedule.scheduleName?.trim() || 'Shift',
    expectedGuards: Math.min(50, Math.max(1, Number(schedule.expectedGuards) || 1)),
    startHour: Number.isInteger(schedule.startHour) ? schedule.startHour : 0,
    endHour: Number.isInteger(schedule.endHour) ? schedule.endHour : 0,
    activeDays: normalizeActiveDays(schedule.activeDays),
    active: schedule.active !== false,
  };
}

export function dedupeSchedulesById(schedules: PatrolSchedule[]): PatrolSchedule[] {
  const byId = new Map<string, PatrolSchedule>();

  for (const schedule of schedules) {
    if (!schedule?.id) {
      continue;
    }

    if (!byId.has(schedule.id)) {
      byId.set(schedule.id, normalizeScheduleRecord(schedule));
    }
  }

  return [...byId.values()];
}

export function dedupeGroupsById(groups: PatrolGroup[]): PatrolGroup[] {
  const byId = new Map<string, PatrolGroup>();

  for (const group of groups) {
    if (!group?.id) {
      continue;
    }

    if (!byId.has(group.id)) {
      byId.set(group.id, group);
    }
  }

  return [...byId.values()];
}

export function sanitizeSitesForAggregation(sites: Site[]): Site[] {
  return sites
    .filter((site) => Boolean(site?.id))
    .map((site) => ({
      ...site,
      siteCode: site.siteCode?.trim() || 'UNKNOWN',
      siteName: site.siteName?.trim() || site.siteCode?.trim() || 'Unknown site',
      groups: dedupeGroupsById((site.groups ?? []).filter((group) => group.active !== false)),
    }));
}

export function coerceSentAtToDate(sentAt: Date | string): Date {
  if (sentAt instanceof Date && !Number.isNaN(sentAt.getTime())) {
    return sentAt;
  }

  const parsed = new Date(sentAt);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  throw new Error(`Invalid sentAt value: ${String(sentAt)}`);
}

export function safeLocaleCompare(left: string | null | undefined, right: string | null | undefined): number {
  return (left ?? '').localeCompare(right ?? '');
}

export function formatAggregationError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}

export function summarizeRecord(record: {
  siteId?: string;
  siteCode?: string;
  siteName?: string | null;
  groupId?: string | null;
  groupName?: string | null;
  scheduleId?: string;
  scheduleName?: string | null;
  expectedGuards?: number | null;
}): string {
  return [
    `siteId=${record.siteId ?? 'none'}`,
    `siteCode=${record.siteCode ?? 'none'}`,
    record.siteName ? `siteName=${record.siteName}` : null,
    `groupId=${record.groupId ?? 'site'}`,
    `groupName=${record.groupName ?? 'none'}`,
    record.scheduleId ? `scheduleId=${record.scheduleId}` : null,
    record.scheduleName ? `scheduleName=${record.scheduleName}` : null,
    record.expectedGuards !== undefined && record.expectedGuards !== null
      ? `expectedGuards=${record.expectedGuards}`
      : null,
  ]
    .filter(Boolean)
    .join(' ');
}

export interface AggregationDataAuditIssue {
  code: string;
  detail: string;
}

export function auditAggregationData(params: {
  sites: Site[];
  schedules: PatrolSchedule[];
  images: PatrolImage[];
  rowDefinitions: Array<{
    siteId: string;
    siteCode: string;
    groupId: string | null;
    groupName: string | null;
  }>;
}): AggregationDataAuditIssue[] {
  const issues: AggregationDataAuditIssue[] = [];
  const knownSiteIds = new Set(params.sites.map((site) => site.id));
  const siteCodeOwners = new Map<string, string>();
  const groupOwners = new Map<string, string>();

  for (const site of params.sites) {
    const siteCode = site.siteCode?.trim() || 'UNKNOWN';
    const existingOwner = siteCodeOwners.get(siteCode);
    if (existingOwner && existingOwner !== site.id) {
      issues.push({
        code: 'duplicate-site-code',
        detail: `siteCode=${siteCode} siteIds=${existingOwner},${site.id}`,
      });
    } else {
      siteCodeOwners.set(siteCode, site.id);
    }

    for (const group of site.groups ?? []) {
      if (!group?.id) {
        issues.push({
          code: 'invalid-group',
          detail: `missing-group-id siteId=${site.id} siteCode=${siteCode}`,
        });
        continue;
      }

      const priorSiteId = groupOwners.get(group.id);
      if (priorSiteId && priorSiteId !== site.id) {
        issues.push({
          code: 'duplicate-group-id',
          detail: `groupId=${group.id} siteIds=${priorSiteId},${site.id}`,
        });
      } else {
        groupOwners.set(group.id, site.id);
      }

      if (group.siteId && group.siteId !== site.id) {
        issues.push({
          code: 'orphan-group-mapping',
          detail: `groupId=${group.id} group.siteId=${group.siteId} actualSiteId=${site.id}`,
        });
      }
    }
  }

  for (const schedule of params.schedules) {
    if (!schedule?.id) {
      issues.push({
        code: 'null-schedule',
        detail: `schedule without id siteId=${schedule?.siteId ?? 'none'}`,
      });
      continue;
    }

    if (!knownSiteIds.has(schedule.siteId)) {
      issues.push({
        code: 'orphan-schedule',
        detail: `scheduleId=${schedule.id} siteId=${schedule.siteId}`,
      });
    }

    if (
      schedule.expectedGuards === null ||
      schedule.expectedGuards === undefined ||
      !Number.isFinite(Number(schedule.expectedGuards))
    ) {
      issues.push({
        code: 'invalid-expected-guards',
        detail: `scheduleId=${schedule.id} expectedGuards=${String(schedule.expectedGuards)}`,
      });
    }

    const activeDays = normalizeActiveDays(schedule.activeDays);
    if (!Array.isArray(schedule.activeDays) || activeDays.length === 0) {
      issues.push({
        code: 'invalid-active-days',
        detail: `scheduleId=${schedule.id} activeDays=${JSON.stringify(schedule.activeDays)}`,
      });
    }
  }

  for (const image of params.images) {
    if (!knownSiteIds.has(image.siteId)) {
      issues.push({
        code: 'orphan-image-site',
        detail: `imageId=${image.id} siteId=${image.siteId}`,
      });
    }

    if (image.groupId && !groupOwners.has(image.groupId)) {
      issues.push({
        code: 'orphan-image-group',
        detail: `imageId=${image.id} groupId=${image.groupId} siteId=${image.siteId}`,
      });
    }
  }

  const rowKeys = new Set<string>();
  for (const row of params.rowDefinitions) {
    const key = `${row.siteId}::${row.groupId ?? 'site'}`;
    if (rowKeys.has(key)) {
      issues.push({
        code: 'duplicate-row-definition',
        detail: summarizeRecord(row),
      });
    } else {
      rowKeys.add(key);
    }
  }

  return issues;
}
