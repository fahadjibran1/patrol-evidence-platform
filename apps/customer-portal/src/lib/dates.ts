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

export function formatMoney(amountPence: number, currency = 'GBP'): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(amountPence / 100);
}
