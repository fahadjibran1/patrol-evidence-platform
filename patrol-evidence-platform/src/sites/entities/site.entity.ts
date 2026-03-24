import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PatrolGroup } from '@/patrol-groups/entities/patrol-group.entity';
import { PatrolSchedule } from '@/patrol-schedules/entities/patrol-schedule.entity';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';
import { PatrolSlot } from '@/patrol-slots/entities/patrol-slot.entity';
import { PatrolAlert } from '@/patrol-alerts/entities/patrol-alert.entity';

@Entity('sites')
export class Site {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ length: 20 })
  siteCode!: string;

  @Column({ length: 120 })
  siteName!: string;

  @Column({ length: 120, nullable: true })
  clientName!: string | null;

  @Column({ default: true })
  active!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToMany(() => PatrolGroup, (group) => group.site)
  groups!: PatrolGroup[];

  @OneToMany(() => PatrolSchedule, (schedule) => schedule.site)
  schedules!: PatrolSchedule[];

  @OneToMany(() => PatrolImage, (image) => image.site)
  images!: PatrolImage[];

  @OneToMany(() => PatrolSlot, (slot) => slot.site)
  slots!: PatrolSlot[];

  @OneToMany(() => PatrolAlert, (alert) => alert.site)
  alerts!: PatrolAlert[];
}
