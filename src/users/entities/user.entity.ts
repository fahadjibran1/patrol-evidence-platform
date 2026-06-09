import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { UserRole } from '@/common/enums/user-role.enum';
import { Company } from '@/companies/entities/company.entity';
import { dateTimeColumn, enumColumn } from '@/common/utils/database-column.util';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({
    type: 'varchar',
    length: 160,
  })
  email!: string;

  @Column({
    type: 'varchar',
    length: 255,
  })
  passwordHash!: string;

  @Column({
    type: 'varchar',
    length: 80,
  })
  firstName!: string;

  @Column({
    type: 'varchar',
    length: 80,
  })
  lastName!: string;

  @Column(enumColumn(UserRole))
  role!: UserRole;

  @Column({
    type: 'uuid',
    nullable: true,
  })
  companyId!: string | null;

  @ManyToOne(() => Company, (company) => company.users, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'companyId' })
  company!: Company | null;

  @Column({
    type: 'boolean',
    default: true,
  })
  active!: boolean;

  @Column({
    type: 'boolean',
    default: true,
  })
  approved!: boolean;

  @CreateDateColumn(dateTimeColumn())
  createdAt!: Date;

  @UpdateDateColumn(dateTimeColumn())
  updatedAt!: Date;
}
