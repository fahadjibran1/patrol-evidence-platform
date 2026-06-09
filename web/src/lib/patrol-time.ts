export const BUSINESS_TIMEZONE = (import.meta.env.VITE_BUSINESS_TIMEZONE as string | undefined)?.trim() || 'Europe/London';

export interface PatrolTimeParts {
  date: string;
  hour: number;
}

export function getPatrolTimeParts(date: Date, timeZone = BUSINESS_TIMEZONE): PatrolTimeParts {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));

  return {
    date: `${values.get('year') ?? '0000'}-${values.get('month') ?? '01'}-${values.get('day') ?? '01'}`,
    hour: Number(values.get('hour') ?? '0'),
  };
}

export function getPatrolToday(): string {
  return getPatrolTimeParts(new Date()).date;
}

export function formatPatrolDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

export function formatPatrolTime(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
}
