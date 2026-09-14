import { getPatrolTimeParts, patrolTimeZone } from '@/common/utils/patrol-time.util';

export interface PatrolScheduleWindow {
  startHour: number;
  endHour: number;
  activeDays: number[] | unknown;
  active?: boolean;
  /** Explicit 24-hour monitoring. Prefer this over ambiguous startHour===endHour. */
  is24Hours?: boolean;
}

/** Fallback used only when a site has no configured schedule for the selected date. */
export const SCHEDULE_FALLBACK_WINDOW = {
  startHour: 6,
  endHour: 22,
  activeDays: [0, 1, 2, 3, 4, 5, 6],
  is24Hours: false,
} as const;

export function normalizeActiveDays(activeDays: unknown): number[] {
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

export function businessDayOfWeek(businessDate: string, _timeZone = patrolTimeZone()): number {
  const [year, month, day] = businessDate.split('-').map((value) => Number(value));
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** True when `hour` falls in [startHour, endHour) in local patrol time. Supports overnight windows (e.g. 18→6). */
export function scheduleCoversHour(
  startHour: number,
  endHour: number,
  hour: number,
  is24Hours = false,
): boolean {
  const targetHour = Number(hour);

  if (!Number.isInteger(targetHour) || targetHour < 0 || targetHour > 23) {
    return false;
  }

  if (is24Hours) {
    return true;
  }

  const start = Number(startHour);
  const end = Number(endHour);

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > 23 || end < 0 || end > 23) {
    return false;
  }

  // Legacy: identical start/end means 24-hour coverage (seed and older records).
  if (start === end) {
    return true;
  }

  if (start < end) {
    return targetHour >= start && targetHour < end;
  }

  return targetHour >= start || targetHour < end;
}

export function scheduleIsActiveOnDate(schedule: PatrolScheduleWindow, businessDate: string): boolean {
  if (schedule.active === false) {
    return false;
  }

  return normalizeActiveDays(schedule.activeDays).includes(businessDayOfWeek(businessDate));
}

export function enumerateScheduleHours(startHour: number, endHour: number, is24Hours = false): number[] {
  if (is24Hours || startHour === endHour) {
    return Array.from({ length: 24 }, (_, hour) => hour);
  }

  const hours: number[] = [];
  let hour = startHour;

  while (hours.length < 24) {
    hours.push(hour);
    hour = (hour + 1) % 24;
    if (hour === endHour) {
      break;
    }
  }

  return hours;
}

export function scheduleCrossesMidnight(startHour: number, endHour: number, is24Hours = false): boolean {
  if (is24Hours || startHour === endHour) {
    return false;
  }
  return startHour > endHour;
}

/** Hours a site should monitor on a business date. Falls back only when no schedule applies. */
export function resolveSiteMonitoringHours<T extends PatrolScheduleWindow & { siteId: string; id?: string; createdAt?: Date | string }>(
  schedules: T[],
  siteId: string,
  businessDate: string,
): {
  hours: number[];
  source: 'configured' | 'fallback';
  schedule: T | typeof SCHEDULE_FALLBACK_WINDOW | null;
  disabledDay: boolean;
  crossesMidnight: boolean;
} {
  const siteSchedules = schedules.filter((schedule) => schedule.siteId === siteId && schedule.active !== false);
  const activeToday = siteSchedules.filter((schedule) => scheduleIsActiveOnDate(schedule, businessDate));

  if (siteSchedules.length > 0 && activeToday.length === 0) {
    return {
      hours: [],
      source: 'configured',
      schedule: null,
      disabledDay: true,
      crossesMidnight: false,
    };
  }

  if (activeToday.length === 0) {
    return {
      hours: enumerateScheduleHours(
        SCHEDULE_FALLBACK_WINDOW.startHour,
        SCHEDULE_FALLBACK_WINDOW.endHour,
        SCHEDULE_FALLBACK_WINDOW.is24Hours,
      ),
      source: 'fallback',
      schedule: SCHEDULE_FALLBACK_WINDOW,
      disabledDay: false,
      crossesMidnight: scheduleCrossesMidnight(
        SCHEDULE_FALLBACK_WINDOW.startHour,
        SCHEDULE_FALLBACK_WINDOW.endHour,
        SCHEDULE_FALLBACK_WINDOW.is24Hours,
      ),
    };
  }

  const hourSet = new Set<number>();
  for (const schedule of activeToday) {
    for (const hour of enumerateScheduleHours(schedule.startHour, schedule.endHour, Boolean(schedule.is24Hours))) {
      hourSet.add(hour);
    }
  }

  const primary = activeToday.sort((left, right) => {
    const leftCreated = left.createdAt ? new Date(left.createdAt).getTime() : 0;
    const rightCreated = right.createdAt ? new Date(right.createdAt).getTime() : 0;
    return rightCreated - leftCreated;
  })[0];

  return {
    hours: [...hourSet].sort((left, right) => left - right),
    source: 'configured',
    schedule: primary,
    disabledDay: false,
    crossesMidnight: scheduleCrossesMidnight(primary.startHour, primary.endHour, Boolean(primary.is24Hours)),
  };
}

export function findActivePatrolSchedule<T extends PatrolScheduleWindow & { siteId: string; id?: string; createdAt?: Date | string }>(
  schedules: T[],
  siteId: string,
  businessDate: string,
  hour: number,
): T | undefined {
  const matches = schedules.filter(
    (schedule) =>
      schedule.siteId === siteId &&
      scheduleIsActiveOnDate(schedule, businessDate) &&
      scheduleCoversHour(schedule.startHour, schedule.endHour, hour, Boolean(schedule.is24Hours)),
  );

  if (matches.length === 0) {
    return undefined;
  }

  return matches.sort((left, right) => {
    const leftCreated = left.createdAt ? new Date(left.createdAt).getTime() : 0;
    const rightCreated = right.createdAt ? new Date(right.createdAt).getTime() : 0;
    return rightCreated - leftCreated;
  })[0];
}

export function patrolScheduleLabel(schedule: {
  scheduleName?: string | null;
  startHour: number;
  endHour: number;
  is24Hours?: boolean;
}): string {
  const name = schedule.scheduleName?.trim();
  const window = schedule.is24Hours
    ? '24 hours'
    : `${String(schedule.startHour).padStart(2, '0')}:00–${String(schedule.endHour).padStart(2, '0')}:00`;
  return name ? `${name} (${window})` : window;
}
