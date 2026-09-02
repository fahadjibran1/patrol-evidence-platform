import { toCsv, toCsvValue } from './csv.util';

describe('toCsvValue', () => {
  it('returns an empty string for null/undefined', () => {
    expect(toCsvValue(null)).toBe('');
    expect(toCsvValue(undefined)).toBe('');
  });

  it('passes through plain values unescaped', () => {
    expect(toCsvValue('hello')).toBe('hello');
    expect(toCsvValue(42)).toBe('42');
    expect(toCsvValue(true)).toBe('true');
  });

  it('serializes Date values to ISO strings', () => {
    const date = new Date('2026-07-21T12:00:00.000Z');
    expect(toCsvValue(date)).toBe('2026-07-21T12:00:00.000Z');
  });

  it('quotes and escapes values containing commas', () => {
    expect(toCsvValue('Acme, Inc.')).toBe('"Acme, Inc."');
  });

  it('quotes and doubles embedded double-quotes', () => {
    expect(toCsvValue('Say "hello"')).toBe('"Say ""hello"""');
  });

  it('quotes values containing newlines', () => {
    expect(toCsvValue('line1\nline2')).toBe('"line1\nline2"');
    expect(toCsvValue('line1\r\nline2')).toBe('"line1\r\nline2"');
  });
});

describe('toCsv', () => {
  it('builds a header row followed by one row per record', () => {
    const csv = toCsv(['id', 'name'], [
      { id: '1', name: 'Alpha' },
      { id: '2', name: 'Beta' },
    ]);

    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('id,name');
    expect(lines[1]).toBe('1,Alpha');
    expect(lines[2]).toBe('2,Beta');
  });

  it('escapes fields that need it within a full document', () => {
    const csv = toCsv(['company', 'notes'], [{ company: 'Acme, Inc.', notes: 'Says "hi"' }]);
    const lines = csv.trim().split('\r\n');
    expect(lines[1]).toBe('"Acme, Inc.","Says ""hi"""');
  });

  it('renders missing keys as empty fields', () => {
    const csv = toCsv(['a', 'b'], [{ a: 'x' }]);
    const lines = csv.trim().split('\r\n');
    expect(lines[1]).toBe('x,');
  });

  it('never truncates or reorders columns based on row content', () => {
    const csv = toCsv(['a', 'b', 'c'], [{ c: '3', a: '1', b: '2' }]);
    const lines = csv.trim().split('\r\n');
    expect(lines[1]).toBe('1,2,3');
  });
});
