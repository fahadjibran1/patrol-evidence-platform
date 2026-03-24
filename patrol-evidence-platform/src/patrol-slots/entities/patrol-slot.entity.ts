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

@Entity('patrol_slots')
export class PatrolSlot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  siteId!: string;

  @ManyToOne(() => Site, (site) => site.slots, { onDelete: 'CASCADE' })
  site!: Site;

  @Column({ type: 'timestamptz' })
  slotStart!: Date;

  @Column({ type: 'timestamptz' })
  slotEnd!: Date;

  @Column({ type: 'timestamptz' })
  expectedAt!: Date;

  @Column({ type: 'enum', enum: PatrolSlotStatus, default: PatrolSlotStatus.PENDING })
  status!: PatrolSlotStatus;

  @Column('uuid', { nullable: true })
  imageId!: string | null;

  @OneToOne(() => PatrolImage, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'imageId' })
  image!: PatrolImage | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
