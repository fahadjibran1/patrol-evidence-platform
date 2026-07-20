import { plainToInstance } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

class EnvVars {
  @IsOptional()
  @IsString()
  NODE_ENV?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  LICENSE_API_PORT?: number;

  @IsOptional()
  @IsString()
  LICENSE_PORTAL_ORIGIN?: string;

  @IsString()
  LICENSE_DATABASE_URL!: string;

  @IsString()
  @MinLength(32)
  JWT_SECRET!: string;

  @IsOptional()
  @IsString()
  JWT_ACCESS_EXPIRES_IN?: string;

  @IsOptional()
  @IsString()
  JWT_REFRESH_EXPIRES_IN?: string;

  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/, {
    message: 'LICENCE_STORAGE_ENCRYPTION_KEY must be 64 hex characters (32 bytes)',
  })
  LICENCE_STORAGE_ENCRYPTION_KEY!: string;

  @IsOptional()
  @IsString()
  LICENSE_PRIVATE_KEY?: string;

  @IsOptional()
  @IsString()
  LICENSE_PRIVATE_KEY_FILE?: string;

  @IsString()
  LICENSE_SIGNING_KEY_ID!: string;
}

export function validateEnv(config: Record<string, unknown>): EnvVars {
  const validated = plainToInstance(EnvVars, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length) {
    throw new Error(errors.toString());
  }

  return validated;
}
