import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Site } from '@/sites/entities/site.entity';
import { PatrolGroup } from '@/patrol-groups/entities/patrol-group.entity';
import { CollectorType } from '@/common/enums/collector-type.enum';
import { PatrolSlotStatus } from '@/common/enums/patrol-slot-status.enum';

@Entity('patrol_images')
export class PatrolImage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  siteId!: string;

  @ManyToOne(() => Site, (site) => site.images, { onDelete: 'CASCADE' })
  site!: Site;

  @Column('uuid', { nullable: true })
  groupId!: string | null;

  @ManyToOne(() => PatrolGroup, (group) => group.images, { nullable: true, onDelete: 'SET NULL' })
  group!: PatrolGroup | null;

  @Column({ type: 'enum', enum: CollectorType })
  collectorType!: CollectorType;

  @Column({ nullable: true, length: 120 })
  senderName!: string | null;

  @Column({ nullable: true, length: 30 })
  senderNumber!: string | null;

  @Column({ nullable: true, length: 120 })
  messageExternalId!: string | null;

  @Column({ type: 'timestamptz' })
  sentAt!: Date;

  @Column({ type: 'timestamptz' })
  receivedAt!: Date;

  @Column({ type: 'date' })
  patrolDate!: string;

  @Column('int')
  patrolHour!: number;

  @Column({ nullable: true, length: 255 })
  originalFileName!: string | null;

  @Column({ length: 255 })
  storedFileName!: string;

  @Column({ length: 600 })
  filePath!: string;

  @Column('bigint')
  fileSize!: string;

  @Column({ length: 100 })
  mimeType!: string;

  @Column({ type: 'enum', enum: PatrolSlotStatus })
  status!: PatrolSlotStatus;

  @Column({ nullable: true, type: 'text' })
  notes!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
