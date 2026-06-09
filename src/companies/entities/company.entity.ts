import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Site } from '@/sites/entities/site.entity';
import { User } from '@/users/entities/user.entity';
import { dateTimeColumn } from '@/common/utils/database-column.util';

@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({
    type: 'varchar',
    length: 160,
  })
  companyName!: string;

  @Column({
    type: 'boolean',
    default: true,
  })
  active!: boolean;

  @CreateDateColumn(dateTimeColumn())
  createdAt!: Date;

  @UpdateDateColumn(dateTimeColumn())
  updatedAt!: Date;

  @OneToMany(() => Site, (site) => site.company)
  sites!: Site[];

  @OneToMany(() => User, (user) => user.company)
  users!: User[];
}
