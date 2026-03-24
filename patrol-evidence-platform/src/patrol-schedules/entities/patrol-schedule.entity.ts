import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Site } from '@/sites/entities/site.entity';

@Entity('patrol_schedules')
export class PatrolSchedule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  siteId!: string;

  @ManyToOne(() => Site, (site) => site.schedules, { onDelete: 'CASCADE' })
  site!: Site;

  @Column('int')
  frequencyMinutes!: number;

  @Column('int')
  startHour!: number;

  @Column('int')
  endHour!: number;

  @Column('int', { default: 15 })
  graceMinutes!: number;

  @Column('jsonb')
  activeDays!: number[];

  @Column({ default: true })
  active!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
