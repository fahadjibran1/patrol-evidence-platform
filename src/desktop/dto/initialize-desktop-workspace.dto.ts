import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class InitializeDesktopWorkspaceDto {
  @IsString()
  @MaxLength(128)
  appTimeZone!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  companyName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  adminFirstName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  adminLastName!: string;

  @IsEmail()
  @MaxLength(160)
  adminEmail!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(120)
  adminPassword!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  workspaceName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  licenseKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(260)
  storageRootPath?: string;

  @IsOptional()
  @IsBoolean()
  autoStartCollector?: boolean;

  @IsOptional()
  @IsBoolean()
  autoLaunchApp?: boolean;

  @IsOptional()
  @IsBoolean()
  whatsappAllowFromMe?: boolean;

  @IsOptional()
  @IsBoolean()
  markSetupComplete?: boolean;
}
