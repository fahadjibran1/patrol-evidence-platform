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
import { Company } from '@/companies/entities/company.entity';
import { Site } from '@/sites/entities/site.entity';
import { IncidentSeverity } from '@/common/enums/incident-severity.enum';
import { IncidentStatus } from '@/common/enums/incident-status.enum';
import { dateTimeColumn, enumColumn } from '@/common/utils/database-column.util';

@Entity('incidents')
export class Incident {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  guardId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'guardId' })
  guard!: User;

  @Column({ type: 'uuid' })
  companyId!: string;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'companyId' })
  company!: Company;

  @Column({ type: 'uuid' })
  siteId!: string;

  @ManyToOne(() => Site, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'siteId' })
  site!: Site;

  @Column({ type: 'text' })
  description!: string;

  @Column(enumColumn(IncidentSeverity))
  severity!: IncidentSeverity;

  @Column(enumColumn(IncidentStatus, { default: IncidentStatus.OPEN }))
  status!: IncidentStatus;

  @CreateDateColumn(dateTimeColumn())
  createdAt!: Date;

  @UpdateDateColumn(dateTimeColumn())
  updatedAt!: Date;
}
