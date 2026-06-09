import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Site } from '@/sites/entities/site.entity';
import { dateTimeColumn, jsonColumn } from '@/common/utils/database-column.util';

@Entity('patrol_schedules')
export class PatrolSchedule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  siteId!: string;

  @ManyToOne(() => Site, (site) => site.schedules, { onDelete: 'CASCADE' })
  site!: Site;

  @Column({ length: 120, default: 'Shift' })
  scheduleName!: string;

  @Column('int', { default: 1 })
  expectedGuards!: number;

  @Column('int')
  frequencyMinutes!: number;

  @Column('int')
  startHour!: number;

  @Column('int')
  endHour!: number;

  @Column('int', { default: 15 })
  graceMinutes!: number;

  @Column(jsonColumn())
  activeDays!: number[];

  @Column({ default: true })
  active!: boolean;

  @CreateDateColumn(dateTimeColumn())
  createdAt!: Date;

  @UpdateDateColumn(dateTimeColumn())
  updatedAt!: Date;
}
