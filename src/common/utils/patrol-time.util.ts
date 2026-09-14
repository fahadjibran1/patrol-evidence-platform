export interface PatrolTimeParts {
  date: string;
  hour: number;
  hourFolder: string;
  timePart: string;
  year: number;
  month: number;
  day: number;
  minute: number;
  second: number;
}

export const DEFAULT_BUSINESS_TIMEZONE = 'Europe/London';

export interface OperationalDateTime {
  date: string;
  hour: number;
  minute?: number;
  second?: number;
}

export function normalizeIanaTimeZone(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const candidate = value.trim();
  if (!candidate || candidate.length > 128) {
    return null;
  }

  try {
    new Intl.DateTimeFormat('en', { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return null;
  }
}

export function assertIanaTimeZone(value: unknown): string {
  const normalized = normalizeIanaTimeZone(value);
  if (!normalized) {
    throw new Error('Choose a valid time zone from the list.');
  }
  return normalized;
}

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
    year: Number(year),
    month: Number(month),
    day: Number(day),
    minute: Number(minute),
    second: Number(second),
  };
}

export function addOperationalCalendarDays(date: string, days: number): string {
  const [year, month, day] = parseOperationalDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(
    shifted.getUTCDate(),
  ).padStart(2, '0')}`;
}

/**
 * Resolve a workspace-local civil time to an absolute instant.
 *
 * During an autumn overlap the earlier occurrence is selected deterministically.
 * During a spring gap the first valid local instant after the gap is selected.
 */
export function operationalDateTimeToUtc(
  input: OperationalDateTime,
  timeZone = patrolTimeZone(),
): Date {
  const normalizedTimeZone = assertIanaTimeZone(timeZone);
  const [year, month, day] = parseOperationalDate(input.date);
  const hour = normalizeCivilPart(input.hour, 0, 23, 'hour');
  const minute = normalizeCivilPart(input.minute ?? 0, 0, 59, 'minute');
  const second = normalizeCivilPart(input.second ?? 0, 0, 59, 'second');
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);

  const offsets = new Set<number>();
  for (const probeDays of [-370, -185, -2, -1, 0, 1, 2, 185, 370]) {
    const probe = new Date(desiredAsUtc + probeDays * 86_400_000);
    const parts = getPatrolTimeParts(probe, normalizedTimeZone);
    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    offsets.add(representedAsUtc - probe.getTime());
  }

  const matches = [...offsets]
    .map((offset) => new Date(desiredAsUtc - offset))
    .filter((candidate) => civilPartsMatch(candidate, input, normalizedTimeZone))
    .sort((left, right) => left.getTime() - right.getTime());

  if (matches[0]) {
    return matches[0];
  }

  // A requested wall time can be absent during the spring-forward gap. Select
  // the first valid local minute after it, matching Temporal's "compatible"
  // behavior and preventing an impossible schedule instant.
  const earliestProbe = desiredAsUtc - 18 * 3_600_000;
  const latestProbe = desiredAsUtc + 18 * 3_600_000;
  for (let instant = earliestProbe; instant <= latestProbe; instant += 60_000) {
    const candidate = new Date(instant);
    const parts = getPatrolTimeParts(candidate, normalizedTimeZone);
    if (parts.date !== input.date) {
      continue;
    }
    const candidateMinute = parts.hour * 60 + parts.minute;
    const desiredMinute = hour * 60 + minute;
    if (candidateMinute >= desiredMinute) {
      return candidate;
    }
  }

  throw new Error(`Unable to resolve operational time ${input.date} ${hour}:${minute} (${normalizedTimeZone})`);
}

export function getOperationalDateUtcBounds(
  date: string,
  timeZone = patrolTimeZone(),
): { startInclusive: Date; endExclusive: Date } {
  return {
    startInclusive: operationalDateTimeToUtc({ date, hour: 0 }, timeZone),
    endExclusive: operationalDateTimeToUtc({ date: addOperationalCalendarDays(date, 1), hour: 0 }, timeZone),
  };
}

export function patrolTimeZone(): string {
  const configured = (
    process.env.BUSINESS_TIMEZONE?.trim() ||
    process.env.APP_TIMEZONE?.trim() ||
    DEFAULT_BUSINESS_TIMEZONE
  );
  return assertIanaTimeZone(configured);
}

function parseOperationalDate(date: string): [number, number, number] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('date must use YYYY-MM-DD format');
  }
  const [year, month, day] = date.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    throw new Error('date must use YYYY-MM-DD format');
  }
  return [year, month, day];
}

function normalizeCivilPart(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is outside the supported range`);
  }
  return value;
}

function civilPartsMatch(candidate: Date, input: OperationalDateTime, timeZone: string): boolean {
  const parts = getPatrolTimeParts(candidate, timeZone);
  return (
    parts.date === input.date &&
    parts.hour === input.hour &&
    parts.minute === (input.minute ?? 0) &&
    parts.second === (input.second ?? 0)
  );
}
