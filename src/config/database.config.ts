import { mkdirSync } from 'fs';
import * as path from 'path';
import { DataSourceOptions } from 'typeorm';
import { Site } from '@/sites/entities/site.entity';
import { PatrolGroup } from '@/patrol-groups/entities/patrol-group.entity';
import { PatrolSchedule } from '@/patrol-schedules/entities/patrol-schedule.entity';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';
import { PatrolSlot } from '@/patrol-slots/entities/patrol-slot.entity';
import { PatrolAlert } from '@/patrol-alerts/entities/patrol-alert.entity';
import { User } from '@/users/entities/user.entity';
import { Company } from '@/companies/entities/company.entity';
import { Incident } from '@/incidents/entities/incident.entity';
import { GuardSenderMapping } from '@/dashboard/entities/guard-sender-mapping.entity';
import { ShiftGuardAssignment } from '@/dashboard/entities/shift-guard-assignment.entity';
import { resolveDatabaseType, resolveSqliteDatabasePath, SupportedDatabaseType } from '@/config/database-settings.util';
import { getDesktopConfigValue, getDesktopNumberConfigValue } from '@/desktop/desktop-config.util';

export const databaseEntities = [
  Company,
  Site,
  PatrolGroup,
  PatrolSchedule,
  PatrolImage,
  PatrolSlot,
  PatrolAlert,
  User,
  Incident,
  GuardSenderMapping,
  ShiftGuardAssignment,
];

export { resolveDatabaseType, resolveSqliteDatabasePath, SupportedDatabaseType };

export function databaseConfig(): DataSourceOptions {
  const databaseType = resolveDatabaseType();

  if (databaseType === 'sqlite') {
    const sqlitePath = resolveSqliteDatabasePath();
    mkdirSync(path.dirname(sqlitePath), { recursive: true });

    return {
      type: 'better-sqlite3',
      database: sqlitePath,
      entities: databaseEntities,
      synchronize: true,
      logging: false,
    };
  }

  return {
    type: 'postgres',
    host: getDesktopConfigValue('dbHost') ?? process.env.DB_HOST ?? 'localhost',
    port: getDesktopNumberConfigValue('dbPort') ?? Number(process.env.DB_PORT ?? 5432),
    username: getDesktopConfigValue('dbUser') ?? process.env.DB_USER ?? 'postgres',
    password: getDesktopConfigValue('dbPassword') ?? process.env.DB_PASSWORD ?? 'postgres',
    database: getDesktopConfigValue('dbName') ?? process.env.DB_NAME ?? 'patrol_evidence',
    entities: databaseEntities,
    migrations: ['dist/database/migrations/*.js'],
    synchronize: false,
    logging: false,
  };
}
