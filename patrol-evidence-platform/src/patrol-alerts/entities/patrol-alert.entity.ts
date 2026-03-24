import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Site } from '@/sites/entities/site.entity';
import { PatrolSlot } from '@/patrol-slots/entities/patrol-slot.entity';

@Entity('patrol_alerts')
export class PatrolAlert {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  siteId!: string;

  @ManyToOne(() => Site, (site) => site.alerts, { onDelete: 'CASCADE' })
  site!: Site;

  @Column('uuid')
  slotId!: string;

  @ManyToOne(() => PatrolSlot, { onDelete: 'CASCADE' })
  slot!: PatrolSlot;

  @Column({ length: 60 })
  alertType!: string;

  @Column({ length: 255 })
  alertMessage!: string;

  @Column({ type: 'timestamptz' })
  alertTime!: Date;

  @Column({ default: false })
  isResolved!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
