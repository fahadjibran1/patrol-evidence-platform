import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class ManualBackfillDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  hours!: number;
}
