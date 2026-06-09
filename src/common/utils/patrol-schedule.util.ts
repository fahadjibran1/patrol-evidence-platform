import { getPatrolTimeParts, patrolTimeZone } from '@/common/utils/patrol-time.util';

export interface PatrolScheduleWindow {
  startHour: number;
  endHour: number;
  activeDays: number[] | unknown;
  active?: boolean;
}

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

const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function businessDayOfWeek(businessDate: string, timeZone = patrolTimeZone()): number {
  const [year, month, day] = businessDate.split('-').map((value) => Number(value));
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(probe);

  return WEEKDAY_TO_INDEX[weekday] ?? 0;
}

/** True when `hour` falls in [startHour, endHour) in local patrol time. Supports overnight windows (e.g. 18→6). */
export function scheduleCoversHour(startHour: number, endHour: number, hour: number): boolean {
  const start = Number(startHour);
  const end = Number(endHour);
  const targetHour = Number(hour);

  if (!Number.isInteger(targetHour) || targetHour < 0 || targetHour > 23) {
    return false;
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > 23 || end < 0 || end > 23) {
    return false;
  }

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

export function enumerateScheduleHours(startHour: number, endHour: number): number[] {
  if (startHour === endHour) {
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
      scheduleCoversHour(schedule.startHour, schedule.endHour, hour),
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

export function patrolScheduleLabel(schedule: { scheduleName?: string | null; startHour: number; endHour: number }): string {
  const name = schedule.scheduleName?.trim();
  const window = `${String(schedule.startHour).padStart(2, '0')}:00–${String(schedule.endHour).padStart(2, '0')}:00`;
  return name ? `${name} (${window})` : window;
}
