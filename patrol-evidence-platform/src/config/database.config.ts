import { DataSourceOptions } from 'typeorm';
import { Site } from '@/sites/entities/site.entity';
import { PatrolGroup } from '@/patrol-groups/entities/patrol-group.entity';
import { PatrolSchedule } from '@/patrol-schedules/entities/patrol-schedule.entity';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';
import { PatrolSlot } from '@/patrol-slots/entities/patrol-slot.entity';
import { PatrolAlert } from '@/patrol-alerts/entities/patrol-alert.entity';

export const databaseConfig = (): DataSourceOptions => ({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME ?? 'patrol_evidence',
  entities: [Site, PatrolGroup, PatrolSchedule, PatrolImage, PatrolSlot, PatrolAlert],
  migrations: ['dist/database/migrations/*.js'],
  synchronize: false,
  logging: false,
});
