import { IsOptional, IsString, MinLength } from 'class-validator';

export class SuspendLicenceDto {
  @IsString()
  @MinLength(3)
  reason!: string;
}

export class RevokeLicenceDto {
  @IsString()
  @MinLength(3)
  reason!: string;
}

export class IssueExistingLicenceDto {
  @IsOptional()
  @IsString()
  customerEmail?: string;

  @IsOptional()
  @IsString()
  startsAt?: string;

  @IsOptional()
  @IsString()
  expiresAt?: string;
}
