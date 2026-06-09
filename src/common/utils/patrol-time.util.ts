export interface PatrolTimeParts {
  date: string;
  hour: number;
  hourFolder: string;
  timePart: string;
}

export const DEFAULT_BUSINESS_TIMEZONE = 'Europe/London';

export function getPatrolTimeParts(date: Date, timeZone = patrolTimeZone()): PatrolTimeParts {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));

  const year = values.get('year') ?? '0000';
  const month = values.get('month') ?? '01';
  const day = values.get('day') ?? '01';
  const hourString = values.get('hour') ?? '00';
  const minute = values.get('minute') ?? '00';
  const second = values.get('second') ?? '00';
  const hour = Number(hourString);

  return {
    date: `${year}-${month}-${day}`,
    hour,
    hourFolder: `${hourString}00`,
    timePart: `${hourString}-${minute}-${second}`,
  };
}

export function patrolTimeZone(): string {
  return (
    process.env.BUSINESS_TIMEZONE?.trim() ||
    process.env.APP_TIMEZONE?.trim() ||
    DEFAULT_BUSINESS_TIMEZONE
  );
}
