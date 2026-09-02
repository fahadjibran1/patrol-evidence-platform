import { IsEmail, IsEnum, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { NotificationType } from '@prisma/client';

export class SendEmailDto {
  @IsEmail()
  to!: string;

  @IsEnum(NotificationType)
  notificationType!: NotificationType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject?: string;

  @IsOptional()
  @IsString()
  html?: string;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsObject()
  templateData?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  actorAdminId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  licenceId?: string;
}

export interface LicenceIssuedTemplateData {
  contactName: string;
  companyName: string;
  licenseId: string;
  plan: string;
  startsAtDisplay: string;
  expiresAtDisplay: string;
  maxDevices: number;
  featuresDisplay?: string;
  activationInstructions: string;
  supportEmail: string;
  fromName: string;
  attachmentFilename: string;
  adminNote?: string;
  companyBrandName?: string;
}
