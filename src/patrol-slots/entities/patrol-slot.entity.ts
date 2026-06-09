import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  OneToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Site } from '@/sites/entities/site.entity';
import { PatrolSlotStatus } from '@/common/enums/patrol-slot-status.enum';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';
import { dateTimeColumn, enumColumn } from '@/common/utils/database-column.util';

@Entity('patrol_slots')
export class PatrolSlot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  siteId!: string;

  @ManyToOne(() => Site, (site) => site.slots, { onDelete: 'CASCADE' })
  site!: Site;

  @Column(dateTimeColumn())
  slotStart!: Date;

  @Column(dateTimeColumn())
  slotEnd!: Date;

  @Column(dateTimeColumn())
  expectedAt!: Date;

  @Column(enumColumn(PatrolSlotStatus, { default: PatrolSlotStatus.PENDING }))
  status!: PatrolSlotStatus;

  @Column('uuid', { nullable: true })
  imageId!: string | null;

  @OneToOne(() => PatrolImage, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'imageId' })
  image!: PatrolImage | null;

  @Column(dateTimeColumn({ nullable: true }))
  resolvedAt!: Date | null;

  @CreateDateColumn(dateTimeColumn())
  createdAt!: Date;

  @UpdateDateColumn(dateTimeColumn())
  updatedAt!: Date;
}
