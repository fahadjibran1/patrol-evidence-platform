import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Site } from '@/sites/entities/site.entity';
import { PatrolImage } from '@/patrol-images/entities/patrol-image.entity';

@Entity('patrol_groups')
export class PatrolGroup {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  siteId!: string;

  @ManyToOne(() => Site, (site) => site.groups, { onDelete: 'CASCADE' })
  site!: Site;

  @Column({ length: 150 })
  groupName!: string;

  @Column({ nullable: true, length: 120 })
  externalGroupId!: string | null;

  @Column({ default: true })
  active!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToMany(() => PatrolImage, (image) => image.group)
  images!: PatrolImage[];
}
