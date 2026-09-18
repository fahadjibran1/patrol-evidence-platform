import { plainToInstance } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min, MinLength, validateSync } from 'class-validator';

class EnvVars {
  @IsOptional()
  @IsString()
  NODE_ENV?: string;

  @IsOptional()
  @IsString()
  APP_TIMEZONE?: string;

  @IsOptional()
  @IsString()
  BUSINESS_TIMEZONE?: string;

  @IsOptional()
  @IsString()
  SECURITY_COMPANY_NAME?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  TRIAL_DAYS?: number;

  @IsOptional()
  @IsString()
  LICENSE_SIGNING_SECRET?: string;

  @IsOptional()
  @IsString()
  LICENSE_PUBLIC_KEY?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  LICENSE_CLOCK_TOLERANCE_HOURS?: number;

  @IsOptional()
  @IsString()
  DESKTOP_CONFIG_PATH?: string;

  @IsOptional()
  @IsString()
  DB_TYPE?: string;

  @IsOptional()
  @IsString()
  SQLITE_DB_PATH?: string;

  @IsOptional()
  @IsBoolean()
  WHATSAPP_ENABLED?: boolean;

  @IsOptional()
  @IsBoolean()
  WHATSAPP_AUTO_START?: boolean;

  @IsOptional()
  @IsBoolean()
  WHATSAPP_HEADLESS?: boolean;

  @IsOptional()
  @IsBoolean()
  WHATSAPP_ALLOW_FROM_ME?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  WHATSAPP_BACKFILL_MESSAGE_LIMIT?: number;

  @IsOptional()
  @IsString()
  WHATSAPP_SESSION_PATH?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_CHROME_PATH?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_PILOT_GROUP_NAME?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_PILOT_SITE_CODE?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(65535)
  PORT?: number;

  @IsOptional()
  @IsString()
  DB_HOST!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT!: number;

  @IsOptional()
  @IsString()
  DB_USER!: string;

  @IsOptional()
  @IsString()
  DB_PASSWORD!: string;

  @IsOptional()
  @IsString()
  DB_NAME!: string;

  @IsOptional()
  @IsString()
  STORAGE_ROOT_PATH!: string;

  @IsOptional()
  @IsString()
  @MinLength(16)
  JWT_SECRET!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  JWT_EXPIRES_IN_HOURS?: number;
}

export function validateEnv(config: Record<string, unknown>): EnvVars {
  const validated = plainToInstance(EnvVars, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length) {
    throw new Error(errors.toString());
  }

  return validated;
}
