import { plainToInstance } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

class EnvVars {
  @IsOptional()
  @IsString()
  NODE_ENV?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT?: number;

  @IsString()
  DB_HOST!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT!: number;

  @IsString()
  DB_USER!: string;

  @IsString()
  DB_PASSWORD!: string;

  @IsString()
  DB_NAME!: string;

  @IsString()
  STORAGE_ROOT_PATH!: string;

  @IsOptional()
  @IsString()
  WHATSAPP_ENABLED?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_PILOT_GROUP_NAME?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_PILOT_SITE_CODE?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_SESSION_PATH?: string;
}

export function validateEnv(config: Record<string, unknown>): EnvVars {
  const validated = plainToInstance(EnvVars, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length) {
    throw new Error(errors.toString());
  }

  return validated;
}
