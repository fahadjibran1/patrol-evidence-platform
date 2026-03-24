import { IsOptional, IsString, MaxLength } from 'class-validator';

export class MockWhatsAppImageDto {
  @IsString()
  @MaxLength(150)
  groupName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  senderName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  senderNumber?: string;

  @IsOptional()
  @IsString()
  timestamp?: string;
}
