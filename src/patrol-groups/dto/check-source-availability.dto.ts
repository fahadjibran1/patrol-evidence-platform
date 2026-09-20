import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

export class CheckSourceAvailabilityDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  sourceIds!: string[];
}
