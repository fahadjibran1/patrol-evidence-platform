import { scheduleCoversHour } from './patrol-schedule';
import { getPatrolTimeParts } from './patrol-time';
import type { DashboardHourlySafetyCell, DashboardSiteRow, PatrolGroup, PatrolSchedule } from '../types';

export type OpsTone = 'green' | 'amber' | 'red';

export function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export function formatSentByLabel(input: {
  senderName?: string | null;
  senderNumber?: string | null;
  sourceLabel?: string | null;
}): string {
  const senderName = input.senderName?.trim();
  const senderNumber = input.senderNumber?.trim();
  const sourceLabel = input.sourceLabel?.trim();

  if (senderName && sourceLabel && senderName !== sourceLabel) {
    return `${senderName} / ${sourceLabel}`;
  }

  if (senderName) {
    return senderName;
  }

  if (senderNumber) {
    return senderNumber;
  }

  if (sourceLabel) {
    return sourceLabel;
  }

  return 'Unknown sender';
}

export function formatOperatorDateTime(value: string | null): string {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

export function patrolCompliancePercent(row: DashboardSiteRow): number {
  const total = row.safeHours + row.missingHours + row.pendingHours;
  if (total <= 0) {
    return row.imagesReceived > 0 ? 100 : 0;
  }

  return Math.round((row.safeHours / total) * 100);
}

export function siteOpsTone(row: DashboardSiteRow): OpsTone {
  if (row.missingHours > 0 || row.unresolvedAlerts > 0) {
    return 'red';
  }

  if (row.pendingHours > 0) {
    return 'amber';
  }

  return 'green';
}

export function siteOpsLabel(tone: OpsTone): string {
  switch (tone) {
    case 'green':
      return 'On track';
    case 'amber':
      return 'Watch';
    case 'red':
      return 'Attention';
  }
}

export function timelineCellTone(status: 'Safe' | 'Missing' | 'Pending', firstPictureTime: string | null): OpsTone {
  if (status === 'Safe') {
    return 'green';
  }

  if (status === 'Pending') {
    return 'amber';
  }

  if (firstPictureTime) {
    return 'amber';
  }

  return 'red';
}

export function timelineCellSymbol(status: 'Safe' | 'Missing' | 'Pending', firstPictureTime: string | null): string {
  if (status === 'Safe') {
    return '✓';
  }

  if (status === 'Pending') {
    return '…';
  }

  return firstPictureTime ? '!' : '✕';
}

export function timelineCellCaption(status: 'Safe' | 'Missing' | 'Pending', firstPictureTime: string | null): string {
  if (status === 'Safe') {
    return 'Reported';
  }

  if (status === 'Pending') {
    return 'Due';
  }

  return firstPictureTime ? 'Late' : 'Missed';
}

export function findPatrolGroup(groups: PatrolGroup[], siteId: string): PatrolGroup | undefined {
  return groups.find((group) => group.siteId === siteId && group.active);
}

export function nextPatrolHint(
  schedule: PatrolSchedule | undefined,
  hourlyCells: DashboardHourlySafetyCell[] | undefined,
  businessDate: string,
): string {
  const now = getPatrolTimeParts(new Date());

  if (hourlyCells?.length) {
    const nextPending = hourlyCells.find((cell) => cell.status === 'Pending' && cell.hour >= now.hour);
    if (nextPending && businessDate === now.date) {
      return `Due ${formatHourLabel(nextPending.hour)}`;
    }

    const nextMissing = hourlyCells.find((cell) => cell.status === 'Missing');
    if (nextMissing) {
      return `Catch-up ${formatHourLabel(nextMissing.hour)}`;
    }
  }

  if (!schedule?.active) {
    return 'No active schedule';
  }

  if (!scheduleCoversHour(schedule.startHour, schedule.endHour, now.hour) && businessDate === now.date) {
    return 'Outside patrol window';
  }

  const start = formatHourLabel(schedule.startHour);
  const end = formatHourLabel(schedule.endHour);
  const label = schedule.scheduleName?.trim() || 'Shift';
  return `${label} ${start}–${end}`;
}
