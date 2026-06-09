import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  RelationId,
  UpdateDateColumn,
} from 'typeorm';
import { Site } from '@/sites/entities/site.entity';
import { PatrolGroup } from '@/patrol-groups/entities/patrol-group.entity';
import { CollectorType } from '@/common/enums/collector-type.enum';
import { PatrolSlotStatus } from '@/common/enums/patrol-slot-status.enum';
import { PatrolSlot } from '@/patrol-slots/entities/patrol-slot.entity';
import { bigintColumn, dateTimeColumn, enumColumn } from '@/common/utils/database-column.util';

@Entity('patrol_images')
export class PatrolImage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  siteId!: string;

  @ManyToOne(() => Site, (site) => site.images, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'siteId' })
  site!: Site;

  @Column({ type: 'uuid', nullable: true })
  groupId?: string;

  @ManyToOne(() => PatrolGroup, (group) => group.images, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'groupId' })
  group?: PatrolGroup;

  @OneToOne(() => PatrolSlot, (slot) => slot.image)
  slot?: PatrolSlot | null;

  @RelationId((image: PatrolImage) => image.slot)
  readonly patrolSlotId?: string | null;

  @Column(enumColumn(CollectorType))
  collectorType!: CollectorType;

  @Column({
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  senderName?: string;

  @Column({
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  senderNumber?: string;

  @Column({
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  senderExternalId?: string;

  @Column({
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  messageExternalId?: string;

  @Column(dateTimeColumn())
  sentAt!: Date;

  @Column(dateTimeColumn())
  receivedAt!: Date;

  @Column({
    type: 'date',
  })
  patrolDate!: string;

  @Column({
    type: 'int',
  })
  patrolHour!: number;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  originalFileName?: string;

  @Column({
    type: 'varchar',
    length: 255,
  })
  storedFileName!: string;

  @Column({
    type: 'varchar',
    length: 600,
  })
  filePath!: string;

  @Column(bigintColumn())
  fileSize!: string;

  @Column({
    type: 'varchar',
    length: 100,
  })
  mimeType!: string;

  @Column(enumColumn(PatrolSlotStatus))
  status!: PatrolSlotStatus;

  @Column({
    type: 'text',
    nullable: true,
  })
  notes?: string;

  @CreateDateColumn(dateTimeColumn())
  createdAt!: Date;

  @UpdateDateColumn(dateTimeColumn())
  updatedAt!: Date;

  get timestamp(): Date {
    return this.sentAt;
  }

  get imageUrl(): string {
    return this.filePath;
  }
}
