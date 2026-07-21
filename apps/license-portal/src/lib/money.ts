/** Parse a pounds/pence string (e.g. "12.50" or "12") into integer pence. */
export function poundsToPence(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) {
    return 0;
  }

  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error('Enter a valid amount with up to two decimal places');
  }

  const [poundsPart, fractionPart = ''] = trimmed.split('.');
  const pounds = Number(poundsPart);
  const pence = Number((fractionPart + '00').slice(0, 2));
  return pounds * 100 + pence;
}

export function penceToPoundsInput(amountPence: number): string {
  const safe = Number.isFinite(amountPence) ? Math.max(0, Math.trunc(amountPence)) : 0;
  return (safe / 100).toFixed(2);
}
