const COMPATIBILITY_TIME_ZONE = 'Europe/London';

export interface PatrolTimeParts {
  date: string;
  hour: number;
  minute: number;
  second: number;
  year: number;
  month: number;
  day: number;
}

export function normalizeIanaTimeZone(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 128) return null;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value.trim() }).format(0);
    return value.trim();
  } catch {
    return null;
  }
}

export function detectWorkstationTimeZone(): string {
  return normalizeIanaTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? 'UTC';
}

let workspaceTimeZone = detectWorkstationTimeZone();

export function setWorkspaceTimeZone(value: string): void {
  const normalized = normalizeIanaTimeZone(value);
  if (!normalized) throw new Error('Choose a valid time zone from the list.');
  workspaceTimeZone = normalized;
}

export function getWorkspaceTimeZone(): string {
  return workspaceTimeZone;
}

export function getLegacyCompatibilityTimeZone(): string {
  return COMPATIBILITY_TIME_ZONE;
}

export function listSupportedTimeZones(): string[] {
  const intlWithValues = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
  const values = [...(intlWithValues.supportedValuesOf?.('timeZone') ?? []),
    detectWorkstationTimeZone(),
    'Europe/London',
    'America/New_York',
    'America/Los_Angeles',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Australia/Sydney',
    'Pacific/Auckland',
    'UTC',
  ];
  return [...new Set(values.map(normalizeIanaTimeZone).filter((value): value is string => Boolean(value)))];
}

export function formatTimeZoneLabel(timeZone: string): string {
  const place = timeZone.split('/').pop()?.replace(/_/g, ' ') ?? timeZone;
  return `${timeZone} — ${place}`;
}

export function getPatrolTimeParts(date: Date, timeZone = getWorkspaceTimeZone()): PatrolTimeParts {
  const formatter = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const values = new Map(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const year = Number(values.get('year') ?? '0');
  const month = Number(values.get('month') ?? '1');
  const day = Number(values.get('day') ?? '1');
  return {
    date: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    hour: Number(values.get('hour') ?? '0'),
    minute: Number(values.get('minute') ?? '0'),
    second: Number(values.get('second') ?? '0'),
    year,
    month,
    day,
  };
}

export function getPatrolToday(now = new Date()): string {
  return getPatrolTimeParts(now).date;
}

export function formatPatrolDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: getWorkspaceTimeZone(),
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

export function formatPatrolDate(value: string | Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: getWorkspaceTimeZone(),
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export function formatPatrolTime(value: string | Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: getWorkspaceTimeZone(),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

export function formatWorkspaceDateTimeInput(value = new Date()): string {
  const parts = getPatrolTimeParts(value);
  return `${parts.date}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export function workspaceDateTimeInputToUtc(value: string): Date {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error('Choose a valid date and time.');
  const [year, month, day] = match[1].split('-').map(Number);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsets = new Set<number>();
  for (const delta of [-185, -2, -1, 0, 1, 2, 185]) {
    const probe = new Date(desired + delta * 86_400_000);
    const parts = getPatrolTimeParts(probe);
    offsets.add(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - probe.getTime());
  }
  const matches = [...offsets]
    .map((offset) => new Date(desired - offset))
    .filter((candidate) => {
      const parts = getPatrolTimeParts(candidate);
      return parts.date === match[1] && parts.hour === hour && parts.minute === minute;
    })
    .sort((left, right) => left.getTime() - right.getTime());
  if (!matches[0]) throw new Error('That local time does not exist in the workspace time zone. Choose another time.');
  return matches[0];
}
