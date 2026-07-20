import type { PatrolSchedule } from '../types';
import { BUSINESS_TIMEZONE } from './patrol-time';

const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function businessDayOfWeek(businessDate: string): number {
  const [year, month, day] = businessDate.split('-').map((value) => Number(value));
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    weekday: 'short',
  }).format(probe);

  return WEEKDAY_TO_INDEX[weekday] ?? 0;
}

export function scheduleCoversHour(
  startHour: number,
  endHour: number,
  hour: number,
  is24Hours = false,
): boolean {
  if (is24Hours || startHour === endHour) {
    return true;
  }

  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }

  return hour >= startHour || hour < endHour;
}

function normalizeActiveDays(activeDays: unknown): number[] {
  if (Array.isArray(activeDays)) {
    return activeDays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  }

  if (typeof activeDays === 'string') {
    try {
      const parsed: unknown = JSON.parse(activeDays);
      return normalizeActiveDays(parsed);
    } catch {
      return [0, 1, 2, 3, 4, 5, 6];
    }
  }

  return [0, 1, 2, 3, 4, 5, 6];
}

export function findActivePatrolSchedule(
  schedules: PatrolSchedule[],
  siteId: string,
  businessDate: string,
  hour: number,
): PatrolSchedule | undefined {
  const dayOfWeek = businessDayOfWeek(businessDate);
  const matches = schedules.filter(
    (schedule) =>
      schedule.siteId === siteId &&
      schedule.active &&
      normalizeActiveDays(schedule.activeDays).includes(dayOfWeek) &&
      scheduleCoversHour(schedule.startHour, schedule.endHour, hour, Boolean(schedule.is24Hours)),
  );

  if (matches.length === 0) {
    return undefined;
  }

  return matches.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

export function formatScheduleWindow(startHour: number, endHour: number, is24Hours = false): string {
  if (is24Hours) {
    return '24 hours';
  }
  const start = `${String(startHour).padStart(2, '0')}:00`;
  const end = `${String(endHour).padStart(2, '0')}:00`;
  return `${start}–${end}`;
}

export function describeEffectiveSchedule(
  schedules: PatrolSchedule[],
  siteId: string,
  businessDate: string,
): {
  configured: PatrolSchedule | null;
  timezone: string;
  source: 'configured' | 'fallback' | 'disabled';
  crossesMidnight: boolean;
  windowLabel: string;
} {
  const siteSchedules = schedules.filter((schedule) => schedule.siteId === siteId && schedule.active);
  const dayOfWeek = businessDayOfWeek(businessDate);
  const activeToday = siteSchedules.filter((schedule) =>
    normalizeActiveDays(schedule.activeDays).includes(dayOfWeek),
  );

  if (siteSchedules.length > 0 && activeToday.length === 0) {
    return {
      configured: siteSchedules[0] ?? null,
      timezone: BUSINESS_TIMEZONE,
      source: 'disabled',
      crossesMidnight: false,
      windowLabel: 'Disabled today',
    };
  }

  if (activeToday.length === 0) {
    return {
      configured: null,
      timezone: BUSINESS_TIMEZONE,
      source: 'fallback',
      crossesMidnight: false,
      windowLabel: '06:00–22:00 (fallback)',
    };
  }

  const primary = activeToday.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const crossesMidnight = !primary.is24Hours && primary.startHour !== primary.endHour && primary.startHour > primary.endHour;

  return {
    configured: primary,
    timezone: BUSINESS_TIMEZONE,
    source: 'configured',
    crossesMidnight,
    windowLabel: formatScheduleWindow(primary.startHour, primary.endHour, Boolean(primary.is24Hours)),
  };
}
