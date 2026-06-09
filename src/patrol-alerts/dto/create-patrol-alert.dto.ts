import { IsEnum, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { PatrolAlertType } from '@/common/enums/patrol-alert-type.enum';

export class CreatePatrolAlertDto {
  @IsUUID()
  siteId!: string;

  @IsEnum(PatrolAlertType)
  alertType!: PatrolAlertType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  alertMessage!: string;
}
