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
import { dateTimeColumn } from '@/common/utils/database-column.util';

@Entity('guard_sender_mappings')
export class GuardSenderMapping {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  guardId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'guardId' })
  guard!: User;

  @Column({
    type: 'varchar',
    length: 30,
  })
  senderNumber!: string;

  @Column({
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  senderDisplayName?: string;

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
