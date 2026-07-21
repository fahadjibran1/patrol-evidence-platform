const STORAGE_KEY = 'patrol-license-portal-auth';

export function formatUkDate(isoDate: string | null | undefined): string {
  if (!isoDate) {
    return '—';
  }

  const datePart = isoDate.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) {
    return datePart;
  }

  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatUkDateTime(isoDateTime: string | null | undefined): string {
  if (!isoDateTime) {
    return '—';
  }

  const date = new Date(isoDateTime);
  if (Number.isNaN(date.getTime())) {
    return isoDateTime;
  }

  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');

  return `${day}/${month}/${year} ${hours}:${minutes} UTC`;
}

export function toIsoDate(value: string): string {
  const trimmed = value.trim();
  const ukMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (ukMatch) {
    return `${ukMatch[3]}-${ukMatch[2]}-${ukMatch[1]}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  throw new Error('Enter a date as DD/MM/YYYY');
}

export function todayIsoDate(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Calendar date in Europe/London for commercial licence start defaults. */
export function todayLondonIsoDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) {
    return todayIsoDate();
  }
  return `${year}-${month}-${day}`;
}

export function addDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function formatMoney(amountPence: number, currency = 'GBP'): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(amountPence / 100);
}

export { STORAGE_KEY };
