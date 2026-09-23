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

  @IsOptional()
  @IsString()
  CUSTOMER_PORTAL_ORIGIN?: string;

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

  @IsOptional()
  @IsString()
  CUSTOMER_JWT_ACCESS_EXPIRES_IN?: string;

  @IsOptional()
  @IsString()
  CUSTOMER_JWT_REFRESH_EXPIRES_IN?: string;

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

  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  SMTP_PORT?: number;

  @IsOptional()
  @IsString()
  SMTP_USERNAME?: string;

  @IsOptional()
  @IsString()
  SMTP_PASSWORD?: string;

  @IsOptional()
  @IsString()
  SMTP_SECURE?: string;

  @IsOptional()
  @IsString()
  SMTP_FROM_NAME?: string;

  @IsOptional()
  @IsString()
  SMTP_FROM_EMAIL?: string;

  @IsOptional()
  @IsString()
  REDIS_URL?: string;

  @IsOptional()
  @IsString()
  APP_VERSION?: string;

  @IsOptional()
  @IsString()
  BUILD_NUMBER?: string;

  @IsOptional()
  @IsString()
  BUILD_TIMESTAMP?: string;

  @IsOptional()
  @IsString()
  GIT_COMMIT?: string;

  @IsOptional()
  @IsString()
  ADMIN_PORTAL_VERSION?: string;

  @IsOptional()
  @IsString()
  CUSTOMER_PORTAL_VERSION?: string;

  @IsOptional()
  @IsString()
  DESKTOP_VERSION?: string;

  @IsOptional()
  @IsString()
  ERROR_REPORTING_PROVIDER?: string;

  @IsOptional()
  @IsString()
  LICENSE_API_ENABLE_SWAGGER?: string;

  @IsOptional()
  @IsString()
  STRIPE_ENABLED?: string;

  @IsOptional()
  @IsString()
  STRIPE_SECRET_KEY?: string;

  @IsOptional()
  @IsString()
  STRIPE_PUBLISHABLE_KEY?: string;

  @IsOptional()
  @IsString()
  STRIPE_WEBHOOK_SECRET?: string;

  @IsOptional()
  @IsString()
  STRIPE_API_VERSION?: string;

  @IsOptional()
  @IsString()
  STRIPE_CHECKOUT_SUCCESS_URL?: string;

  @IsOptional()
  @IsString()
  STRIPE_CHECKOUT_CANCEL_URL?: string;

  @IsOptional()
  @IsString()
  STRIPE_BILLING_PORTAL_RETURN_URL?: string;

  @IsOptional()
  @IsString()
  BILLING_GRACE_PERIOD_DAYS?: string;

  @IsOptional()
  @IsString()
  BILLING_TERMS_VERSION?: string;

  @IsOptional()
  @IsString()
  STRIPE_WEBHOOK_MAX_ATTEMPTS?: string;

  @IsOptional()
  @IsString()
  COMMERCIAL_STRIPE_ENABLED?: string;

  @IsOptional()
  @IsString()
  COMMERCIAL_STRIPE_SECRET_KEY?: string;

  @IsOptional()
  @IsString()
  COMMERCIAL_STRIPE_WEBHOOK_SECRET?: string;

  @IsOptional()
  @IsString()
  COMMERCIAL_STRIPE_PRODUCT_ID?: string;

  @IsOptional()
  @IsString()
  COMMERCIAL_STRIPE_PRICE_ID?: string;

  @IsOptional()
  @IsString()
  COMMERCIAL_STRIPE_PRICE_LOOKUP_KEY?: string;

  @IsOptional()
  @IsString()
  COMMERCIAL_STRIPE_PRICE_TAX_BEHAVIOR?: string;

  @IsOptional()
  @IsString()
  COMMERCIAL_STRIPE_API_VERSION?: string;

  @IsOptional()
  @IsString()
  COMMERCIAL_CHECKOUT_SUCCESS_URL?: string;

  @IsOptional()
  @IsString()
  COMMERCIAL_CHECKOUT_CANCEL_URL?: string;

  @IsOptional()
  @IsString()
  COMMERCIAL_TERMS_VERSION?: string;

  @IsOptional()
  @IsString()
  COMMERCIAL_PRIVACY_VERSION?: string;

  @IsOptional()
  @IsString()
  COMMERCIAL_OUTBOX_WORKER_ENABLED?: string;
}

function isTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase());
}

export function validateEnv(config: Record<string, unknown>): EnvVars {
  const validated = plainToInstance(EnvVars, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length) {
    throw new Error(errors.toString());
  }

  const stripeEnabled = isTruthy(validated.STRIPE_ENABLED);
  if (stripeEnabled) {
    const missing: string[] = [];
    if (!validated.STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY');
    if (!validated.STRIPE_WEBHOOK_SECRET) missing.push('STRIPE_WEBHOOK_SECRET');
    if (!validated.STRIPE_PUBLISHABLE_KEY) missing.push('STRIPE_PUBLISHABLE_KEY');
    if (validated.NODE_ENV === 'production' && missing.length > 0) {
      throw new Error(
        `[validate-env] STRIPE_ENABLED=true but required secrets missing: ${missing.join(', ')}`,
      );
    }
    if (missing.length > 0) {
      console.warn(
        `[validate-env] STRIPE_ENABLED=true but incomplete configuration (${missing.join(', ')}). Checkout will fail until set.`,
      );
    }
    const key = validated.STRIPE_SECRET_KEY ?? '';
    if (key.startsWith('sk_live_') && validated.NODE_ENV !== 'production') {
      console.warn('[validate-env] Live Stripe secret key detected outside production — refuse to mix modes.');
    }
  }

  const commercialStripeEnabled = isTruthy(validated.COMMERCIAL_STRIPE_ENABLED);
  if (commercialStripeEnabled) {
    if (!validated.COMMERCIAL_STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
      throw new Error('[validate-env] Commercial payments require an explicit Stripe TEST secret key.');
    }
    if (!validated.COMMERCIAL_STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')) {
      throw new Error('[validate-env] Commercial payments require a Stripe TEST webhook secret.');
    }
    if (!validated.COMMERCIAL_STRIPE_PRODUCT_ID?.startsWith('prod_')) {
      throw new Error('[validate-env] Commercial payments require a configured Stripe sandbox Product ID.');
    }
    if (!validated.COMMERCIAL_STRIPE_PRICE_ID?.startsWith('price_')) {
      throw new Error('[validate-env] Commercial payments require a configured Stripe sandbox Price ID.');
    }
    if (!validated.COMMERCIAL_STRIPE_PRICE_LOOKUP_KEY) {
      throw new Error('[validate-env] Commercial payments require a configured Stripe Price lookup key.');
    }
    if (validated.COMMERCIAL_STRIPE_PRICE_TAX_BEHAVIOR !== 'inclusive') {
      throw new Error('[validate-env] Commercial Stripe Price tax behaviour must be explicitly inclusive.');
    }
  }
  if (validated.COMMERCIAL_STRIPE_SECRET_KEY?.startsWith('sk_live_')) {
    throw new Error('[validate-env] Live Stripe credentials are not authorized for commercial Phase 2.');
  }

  // Optional infrastructure — never fail startup for these, but warn loudly in production
  // so an operator notices a missing Redis/SMTP configuration on a live deploy.
  if (validated.NODE_ENV === 'production') {
    if (!validated.REDIS_URL) {
      console.warn(
        '[validate-env] REDIS_URL is not set — email delivery will run in the synchronous inline queue ' +
          '(no cross-instance retry durability). Set REDIS_URL for production-grade queuing.',
      );
    }
    const smtpFields = [
      validated.SMTP_HOST,
      validated.SMTP_PORT,
      validated.SMTP_USERNAME,
      validated.SMTP_PASSWORD,
      validated.SMTP_FROM_EMAIL,
    ];
    const smtpPartiallyOrFullyMissing = smtpFields.some((field) => field === undefined || field === null || field === '');
    if (smtpPartiallyOrFullyMissing) {
      console.warn(
        '[validate-env] SMTP is not fully configured (SMTP_HOST/SMTP_PORT/SMTP_USERNAME/SMTP_PASSWORD/SMTP_FROM_EMAIL) ' +
          '— outbound email will fail until all SMTP_* variables are set.',
      );
    }
  }

  return validated;
}
