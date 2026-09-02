/** Escapes a single CSV field per RFC 4180: wraps in quotes and doubles any embedded quotes
 * whenever the value contains a comma, quote, or line break. */
export function toCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Builds a full CSV document (header row + data rows) from an ordered list of column keys. */
export function toCsv<T extends Record<string, unknown>>(columns: string[], rows: T[]): string {
  const lines = [columns.map(toCsvValue).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => toCsvValue(row[column])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
