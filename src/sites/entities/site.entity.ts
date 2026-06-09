import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PatrolGroup } from '@/patrol-groups/entities/patrol-group.entity';
import { PatrolSchedule } from '@/patrol-schedules/entities/patrol-schedule.entity';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';
import { PatrolSlot } from '@/patrol-slots/entities/patrol-slot.entity';
import { PatrolAlert } from '@/patrol-alerts/entities/patrol-alert.entity';
import { Company } from '@/companies/entities/company.entity';
import { dateTimeColumn } from '@/common/utils/database-column.util';

@Entity('sites')
export class Site {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'uuid',
  })
  companyId!: string;

  @ManyToOne(() => Company, (company) => company.sites, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyId' })
  company!: Company;

  @Index({ unique: true })
  @Column({
    type: 'varchar',
    length: 20,
  })
  siteCode!: string;

  @Column({
    type: 'varchar',
    length: 120,
  })
  siteName!: string;

  @Column({
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  clientName?: string;

  @Column({
    type: 'boolean',
    default: true,
  })
  active!: boolean;

  @CreateDateColumn(dateTimeColumn())
  createdAt!: Date;

  @UpdateDateColumn(dateTimeColumn())
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
