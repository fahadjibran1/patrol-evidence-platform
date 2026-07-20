import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '@/users/entities/user.entity';
import { dateTimeColumn } from '@/common/utils/database-column.util';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128 })
  tokenHash!: string;

  @Column(dateTimeColumn())
  expiresAt!: Date;

  @Column({ ...dateTimeColumn(), nullable: true })
  revokedAt?: Date | null;

  @CreateDateColumn(dateTimeColumn())
  createdAt!: Date;
}
