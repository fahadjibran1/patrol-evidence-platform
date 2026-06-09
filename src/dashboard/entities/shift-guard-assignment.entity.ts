import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '@/users/entities/user.entity';
import { Site } from '@/sites/entities/site.entity';
import { PatrolGroup } from '@/patrol-groups/entities/patrol-group.entity';
import { dateTimeColumn } from '@/common/utils/database-column.util';

@Entity('shift_guard_assignments')
export class ShiftGuardAssignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  siteId!: string;

  @ManyToOne(() => Site, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'siteId' })
  site!: Site;

  @Column({ type: 'uuid', nullable: true })
  groupId!: string | null;

  @ManyToOne(() => PatrolGroup, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'groupId' })
  group!: PatrolGroup | null;

  @Column({ type: 'uuid' })
  guardId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'guardId' })
  guard!: User;

  @Column({ type: 'date' })
  shiftDate!: string;

  @Column({ type: 'int' })
  startHour!: number;

  @Column({ type: 'int' })
  endHour!: number;

  @Column({
    type: 'boolean',
    default: true,
  })
  active!: boolean;

  @CreateDateColumn(dateTimeColumn())
  createdAt!: Date;

  @UpdateDateColumn(dateTimeColumn())
  updatedAt!: Date;
}
