import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class ManualIngestDto {
  @IsString()
  @MaxLength(20)
  siteCode!: string;

  @IsDateString()
  timestamp!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  senderName?: string;
}
