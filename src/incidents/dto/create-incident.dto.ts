import { IsEnum, IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { IncidentSeverity } from '@/common/enums/incident-severity.enum';

export class CreateIncidentDto {
  @IsUUID()
  siteId!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsEnum(IncidentSeverity)
  severity!: IncidentSeverity;
}
