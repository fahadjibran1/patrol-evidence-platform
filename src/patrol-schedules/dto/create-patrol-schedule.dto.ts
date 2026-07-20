import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePatrolScheduleDto {
  @IsUUID()
  siteId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  scheduleName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  expectedGuards?: number;

  @IsInt()
  @Min(5)
  @Max(1440)
  frequencyMinutes!: number;

  @IsInt()
  @Min(0)
  @Max(23)
  startHour!: number;

  @IsInt()
  @Min(0)
  @Max(23)
  endHour!: number;

  @IsOptional()
  @IsBoolean()
  is24Hours?: boolean;

  @IsInt()
  @Min(0)
  @Max(120)
  graceMinutes!: number;

  @IsArray()
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  activeDays!: number[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
