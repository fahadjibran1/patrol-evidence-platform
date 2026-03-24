import { IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CollectorType } from '@/common/enums/collector-type.enum';

export class CreatePatrolImageDto {
  @IsUUID()
  siteId!: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;

  @IsEnum(CollectorType)
  collectorType!: CollectorType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  senderName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  senderNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  messageExternalId?: string;

  @IsDateString()
  sentAt!: string;

  @IsDateString()
  receivedAt!: string;

  @IsString()
  patrolDate!: string;

  @IsInt()
  patrolHour!: number;

  @IsOptional()
  @IsString()
  originalFileName?: string;

  @IsString()
  storedFileName!: string;

  @IsString()
  filePath!: string;

  @IsString()
  fileSize!: string;

  @IsString()
  mimeType!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
