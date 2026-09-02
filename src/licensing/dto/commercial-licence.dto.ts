import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateLicenceRequestFileDto {
  @IsString()
  @MinLength(2)
  companyName!: string;

  @IsOptional()
  @IsIn(['annual', 'three_year', 'lifetime'])
  requestedPlan?: 'annual' | 'three_year' | 'lifetime';
}

export class ImportLicenceDto {
  @IsString()
  @MinLength(20)
  licenceFileContents!: string;
}
