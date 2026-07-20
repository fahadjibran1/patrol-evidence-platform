import { InstallationStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateInstallationDto {
  @IsString()
  @MinLength(3)
  installationId!: string;

  @IsOptional()
  @IsString()
  deviceLabel?: string;

  @IsOptional()
  @IsDateString()
  customerProvidedAt?: string;

  @IsOptional()
  @IsEnum(InstallationStatus)
  status?: InstallationStatus = InstallationStatus.PENDING;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateInstallationDto {
  @IsOptional()
  @IsString()
  deviceLabel?: string;

  @IsOptional()
  @IsDateString()
  customerProvidedAt?: string;

  @IsOptional()
  @IsDateString()
  firstSeenAt?: string;

  @IsOptional()
  @IsDateString()
  lastSeenAt?: string;

  @IsOptional()
  @IsEnum(InstallationStatus)
  status?: InstallationStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}
