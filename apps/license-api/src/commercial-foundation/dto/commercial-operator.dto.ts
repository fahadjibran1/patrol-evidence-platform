import { IsString, Length, Matches } from 'class-validator';

export class CommercialStepUpDto {
  @IsString()
  @Length(12, 256)
  password!: string;
}

export class CommercialDecisionDto {
  @IsString()
  @Length(3, 500)
  @Matches(/\S/, { message: 'reason must contain non-whitespace characters' })
  reason!: string;
}
