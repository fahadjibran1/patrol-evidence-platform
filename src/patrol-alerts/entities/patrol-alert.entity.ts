import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Site } from '@/sites/entities/site.entity';
import { PatrolSlot } from '@/patrol-slots/entities/patrol-slot.entity';
import { PatrolAlertType } from '@/common/enums/patrol-alert-type.enum';
import { User } from '@/users/entities/user.entity';
import { dateTimeColumn, enumColumn } from '@/common/utils/database-column.util';

@Entity('patrol_alerts')
export class PatrolAlert {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  siteId!: string;

  @ManyToOne(() => Site, (site) => site.alerts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'siteId' })
  site!: Site;

  @Column('uuid', { nullable: true })
  slotId!: string | null;

  @ManyToOne(() => PatrolSlot, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'slotId' })
  slot!: PatrolSlot | null;

  @Column('uuid', { nullable: true })
  guardId!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'guardId' })
  guard!: User | null;

  @Column(enumColumn(PatrolAlertType))
  alertType!: PatrolAlertType;

  @Column({ length: 255 })
  alertMessage!: string;

  @Column(dateTimeColumn())
  alertTime!: Date;

  @Column({ default: false })
  isResolved!: boolean;

  @Column(dateTimeColumn({ nullable: true }))
  resolvedAt!: Date | null;

  @CreateDateColumn(dateTimeColumn())
  createdAt!: Date;

  @UpdateDateColumn(dateTimeColumn())
  updatedAt!: Date;
}
