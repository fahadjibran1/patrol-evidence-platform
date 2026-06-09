import type { ColumnOptions } from 'typeorm';
import { resolveDatabaseType } from '@/config/database-settings.util';

function isSqliteDatabase(): boolean {
  return resolveDatabaseType() === 'sqlite';
}

export function dateTimeColumn(options: ColumnOptions = {}): ColumnOptions {
  return {
    ...options,
    type: isSqliteDatabase() ? 'datetime' : 'timestamptz',
  };
}

export function enumColumn<TEnum extends Record<string, string>>(
  enumValues: TEnum,
  options: ColumnOptions = {},
): ColumnOptions {
  if (isSqliteDatabase()) {
    return {
      ...options,
      type: 'text',
    };
  }

  return {
    ...options,
    type: 'enum',
    enum: enumValues,
  };
}

export function jsonColumn(options: ColumnOptions = {}): ColumnOptions {
  return {
    ...options,
    type: isSqliteDatabase() ? 'simple-json' : 'jsonb',
  };
}

export function bigintColumn(options: ColumnOptions = {}): ColumnOptions {
  return {
    ...options,
    type: isSqliteDatabase() ? 'integer' : 'bigint',
  };
}

export function databaseTimestampType(): 'timestamptz' | 'datetime' {
  return dateTimeColumn().type as 'timestamptz' | 'datetime';
}

export function databaseJsonType(): ColumnOptions {
  return jsonColumn();
}

export function databaseEnumColumn<TEnum extends Record<string, string>>(
  enumValues: TEnum,
  defaultValue?: TEnum[keyof TEnum],
): ColumnOptions {
  return enumColumn(
    enumValues,
    defaultValue === undefined
      ? {}
      : {
          default: defaultValue,
        },
  );
}
