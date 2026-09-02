import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class EmailLicenceDto {
  @IsOptional()
  @IsEmail()
  recipientEmail?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @ValidateIf((dto: EmailLicenceDto) => dto.source === 'licence-detail')
  @IsString()
  @MinLength(1)
  password?: string;

  @IsIn(['issue-success', 'licence-detail'])
  source!: 'issue-success' | 'licence-detail';

  /**
   * Sensitive: issue-success only. Used solely to build the in-memory .lic attachment.
   * Never logged, audited, or persisted.
   */
  @ValidateIf((dto: EmailLicenceDto) => dto.source === 'issue-success')
  @IsString()
  @MinLength(10)
  fullLicenseKey?: string;
}
