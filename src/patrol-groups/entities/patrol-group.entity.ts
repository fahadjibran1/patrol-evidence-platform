import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Site } from '@/sites/entities/site.entity';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';
import { dateTimeColumn } from '@/common/utils/database-column.util';
import { PatrolSourceType } from '@/common/enums/patrol-source-type.enum';

@Entity('patrol_groups')
export class PatrolGroup {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  siteId!: string;

  @ManyToOne(() => Site, (site) => site.groups, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'siteId' })
  site!: Site;

  @Column({
    type: 'varchar',
    length: 150,
  })
  groupName!: string;

  @Column({
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  externalGroupId?: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: PatrolSourceType.GROUP,
  })
  sourceType!: PatrolSourceType;

  @Column({
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  linkedAccountId?: string;

  @Column({
    type: 'boolean',
    default: true,
  })
  active!: boolean;

  @CreateDateColumn(dateTimeColumn())
  createdAt!: Date;

  @UpdateDateColumn(dateTimeColumn())
  updatedAt!: Date;

  @OneToMany(() => PatrolImage, (image) => image.group)
  images!: PatrolImage[];
}
