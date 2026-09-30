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
import {
  configuredCommercialMode,
  effectiveCommercialMode,
} from '../commercial-foundation/commercial-mode';
import { COMMERCIAL_STRIPE_PRODUCTION_API_VERSION } from '../commercial-foundation/commercial.constants';

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

  @IsOptional()
  @IsString()
  @Matches(/^(?:true|false)$/i, {
    message: 'LICENSE_LEGACY_ISSUANCE_ENABLED must be true or false',
  })
  LICENSE_LEGACY_ISSUANCE_ENABLED?: string;

  @IsOptional()
  @IsString()
  LICENSE_SIGNING_KEY_ID?: string;

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

  @IsOptional()
  @IsString()
  COMMERCIAL_ARTIFACT_STORE?: string;

  @IsOptional()
  @IsString()
  COMMERCIAL_LEAN_STAGING_PORTALS?: string;

  @IsOptional()
  @IsString()
  PATROLSAFE_COMMERCIAL_STAGING?: string;

  @IsOptional() @IsString() COMMERCIAL_MODE?: string;
  @IsOptional() @IsString() COMMERCIAL_SERVICE_ORIGIN?: string;
  @IsOptional() @IsString() COMMERCIAL_DATABASE_ENVIRONMENT?: string;
  @IsOptional() @IsString() COMMERCIAL_UK_ONLY_ENABLED?: string;
  @IsOptional() @IsString() COMMERCIAL_VAT_CONFIGURATION_APPROVED?: string;
  @IsOptional() @IsString() COMMERCIAL_STRIPE_INVOICE_CREATION_ENABLED?: string;
  @IsOptional() @IsString() COMMERCIAL_STRIPE_TAX_RATE_ID?: string;
  @IsOptional() @IsString() COMMERCIAL_EMBEDDED_PORTALS?: string;
  @IsOptional() @IsString() COMMERCIAL_PRODUCTION_SIGNING_PROVIDER?: string;
  @IsOptional() @IsString() COMMERCIAL_PRODUCTION_SIGNING_KEY_ID?: string;
  @IsOptional() @IsString() COMMERCIAL_PRODUCTION_SIGNING_PRIVATE_KEY_FILE?: string;
  @IsOptional() @IsString() COMMERCIAL_PRODUCTION_SIGNING_PUBLIC_KEY_SHA256?: string;
  @IsOptional() @IsString() COMMERCIAL_DELIVERY_PROVIDER?: string;
  @IsOptional() @IsString() COMMERCIAL_DELIVERY_TOKEN_SECRET?: string;
  @IsOptional() @IsString() COMMERCIAL_LICENCE_DOWNLOAD_BASE_URL?: string;
  @IsOptional() @IsString() COMMERCIAL_TEST_ISSUER_ENABLED?: string;
  @IsOptional() @IsString() COMMERCIAL_TEST_SIGNING_KEY_ID?: string;
  @IsOptional() @IsString() COMMERCIAL_TEST_SIGNING_PRIVATE_KEY_FILE?: string;
  @IsOptional() @IsString() COMMERCIAL_RESEND_ENABLED?: string;
  @IsOptional() @IsString() COMMERCIAL_RESEND_API_KEY?: string;
  @IsOptional() @IsString() COMMERCIAL_RESEND_FROM?: string;
  @IsOptional() @IsString() COMMERCIAL_RESEND_WEBHOOK_SECRET?: string;
}


function validateProductionIsolation(config: EnvVars, configuredMode: string): void {
  if (isTruthy(config.PATROLSAFE_COMMERCIAL_STAGING)
    || isTruthy(config.COMMERCIAL_LEAN_STAGING_PORTALS)
    || isTruthy(config.COMMERCIAL_TEST_ISSUER_ENABLED)
    || config.COMMERCIAL_TEST_SIGNING_KEY_ID
    || config.COMMERCIAL_TEST_SIGNING_PRIVATE_KEY_FILE) {
    throw new Error('[validate-env] Staging/test commercial configuration is forbidden in production.');
  }
  if (configuredMode === 'STAGING_TEST') {
    throw new Error('[validate-env] STAGING_TEST commercial mode is forbidden in production.');
  }
  if (/^(?:sk|rk)_test_/.test(config.COMMERCIAL_STRIPE_SECRET_KEY ?? '')) {
    throw new Error('[validate-env] Stripe test credentials are forbidden in production.');
  }
  const urls = [config.COMMERCIAL_SERVICE_ORIGIN, config.LICENSE_PORTAL_ORIGIN, config.CUSTOMER_PORTAL_ORIGIN,
    config.COMMERCIAL_CHECKOUT_SUCCESS_URL, config.COMMERCIAL_CHECKOUT_CANCEL_URL,
    config.COMMERCIAL_LICENCE_DOWNLOAD_BASE_URL].filter((value): value is string => Boolean(value));
  if (urls.some((value) => /(?:staging|\.onrender\.com)/i.test(value))) {
    throw new Error('[validate-env] Staging or Render-generated commercial URLs are forbidden in production.');
  }
}

function validateProductionCommercialContract(config: EnvVars): void {
  if (config.NODE_ENV !== 'production') throw new Error('[validate-env] PRODUCTION_LIVE requires NODE_ENV=production.');
  if (config.COMMERCIAL_DATABASE_ENVIRONMENT !== 'production') {
    throw new Error('[validate-env] Production database must be explicitly classified as production.');
  }
  assertProductionDatabaseUrl(config.LICENSE_DATABASE_URL);
  const origin = assertProductionOrigin(config.COMMERCIAL_SERVICE_ORIGIN, 'COMMERCIAL_SERVICE_ORIGIN');
  for (const [name, value] of [['LICENSE_PORTAL_ORIGIN', config.LICENSE_PORTAL_ORIGIN],
    ['CUSTOMER_PORTAL_ORIGIN', config.CUSTOMER_PORTAL_ORIGIN]] as const) {
    if (assertProductionOrigin(value, name) !== origin) throw new Error(`[validate-env] ${name} must equal COMMERCIAL_SERVICE_ORIGIN.`);
  }
  assertOrderRedirect(config.COMMERCIAL_CHECKOUT_SUCCESS_URL, origin, 'COMMERCIAL_CHECKOUT_SUCCESS_URL');
  assertOrderRedirect(config.COMMERCIAL_CHECKOUT_CANCEL_URL, origin, 'COMMERCIAL_CHECKOUT_CANCEL_URL');
  assertUrlAtOrigin(config.COMMERCIAL_LICENCE_DOWNLOAD_BASE_URL, origin, 'COMMERCIAL_LICENCE_DOWNLOAD_BASE_URL');
  if (!isTruthy(config.COMMERCIAL_UK_ONLY_ENABLED)) throw new Error('[validate-env] Production launch must enforce UK-only sales.');
  if (!isTruthy(config.COMMERCIAL_VAT_CONFIGURATION_APPROVED)
    || !isTruthy(config.COMMERCIAL_STRIPE_INVOICE_CREATION_ENABLED)
    || !config.COMMERCIAL_STRIPE_TAX_RATE_ID?.startsWith('txr_')) {
    throw new Error('[validate-env] Production VAT, TaxRate, and invoice configuration must be approved.');
  }
  if (config.COMMERCIAL_ARTIFACT_STORE !== 'database') {
    throw new Error('[validate-env] Production licence artifacts require the encrypted database store.');
  }
  if (config.COMMERCIAL_STRIPE_API_VERSION !== COMMERCIAL_STRIPE_PRODUCTION_API_VERSION) {
    throw new Error(`[validate-env] Production Stripe API version must be ${COMMERCIAL_STRIPE_PRODUCTION_API_VERSION}.`);
  }
  if (!isTruthy(config.COMMERCIAL_OUTBOX_WORKER_ENABLED)) {
    throw new Error('[validate-env] Production durable commercial outbox processing must be enabled.');
  }
  if (config.COMMERCIAL_DELIVERY_PROVIDER !== 'resend'
    || !isTruthy(config.COMMERCIAL_RESEND_ENABLED)
    || !config.COMMERCIAL_RESEND_API_KEY
    || !config.COMMERCIAL_RESEND_FROM
    || !config.COMMERCIAL_RESEND_WEBHOOK_SECRET?.startsWith('whsec_')
    || (config.COMMERCIAL_DELIVERY_TOKEN_SECRET?.length ?? 0) < 32) {
    throw new Error('[validate-env] Production delivery provider configuration is incomplete.');
  }
  if (!config.COMMERCIAL_TERMS_VERSION || /^pending/i.test(config.COMMERCIAL_TERMS_VERSION)
    || !config.COMMERCIAL_PRIVACY_VERSION || /^pending/i.test(config.COMMERCIAL_PRIVACY_VERSION)) {
    throw new Error('[validate-env] Approved production Terms and Privacy versions are required.');
  }
  if (config.COMMERCIAL_PRODUCTION_SIGNING_PROVIDER !== 'secret-file-ed25519-v1'
    || config.COMMERCIAL_PRODUCTION_SIGNING_KEY_ID !== 'vesoft-online-v1'
    || config.COMMERCIAL_PRODUCTION_SIGNING_PRIVATE_KEY_FILE !== '/etc/secrets/patrolsafe-production-ed25519-private.pem'
    || !/^[0-9a-fA-F]{64}$/.test(config.COMMERCIAL_PRODUCTION_SIGNING_PUBLIC_KEY_SHA256 ?? '')
    || /^0{64}$/.test(config.COMMERCIAL_PRODUCTION_SIGNING_PUBLIC_KEY_SHA256 ?? '')
    || config.COMMERCIAL_PRODUCTION_SIGNING_PUBLIC_KEY_SHA256?.toUpperCase() === '688340412959FBC23E8C3F0CB17BC6CFC2EE121254ACE2256D66216B2A512582') {
    throw new Error('[validate-env] Production Ed25519 signing configuration is missing, invalid, or staging-contaminated.');
  }
}

function assertProductionDatabaseUrl(value: string): void {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('[validate-env] Production database URL is malformed.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
    || /(?:staging|sandbox|test|localhost|127\.0\.0\.1)/i.test(`${parsed.hostname}${parsed.pathname}`)) {
    throw new Error('[validate-env] Production database URL is not an isolated production PostgreSQL target.');
  }
}

function assertProductionOrigin(value: string | undefined, name: string): string {
  let parsed: URL;
  try { parsed = new URL(value ?? ''); } catch { throw new Error(`[validate-env] ${name} must be a valid HTTPS origin.`); }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password || parsed.pathname !== '/'
    || parsed.search || parsed.hash || (host !== 'sfour.co.uk' && !host.endsWith('.sfour.co.uk'))
    || /staging/i.test(host) || host.endsWith('.onrender.com')) {
    throw new Error(`[validate-env] ${name} must be an approved production sfour.co.uk HTTPS origin.`);
  }
  return parsed.origin;
}

function assertOrderRedirect(value: string | undefined, origin: string, name: string): void {
  if ((value?.match(/\{ORDER_REFERENCE\}/g)?.length ?? 0) !== 1) {
    throw new Error(`[validate-env] ${name} must contain exactly one server-controlled order placeholder.`);
  }
  assertUrlAtOrigin(value, origin, name);
}

function assertUrlAtOrigin(value: string | undefined, origin: string, name: string): void {
  let parsed: URL;
  try { parsed = new URL((value ?? '').replace('{ORDER_REFERENCE}', 'ord_test')); }
  catch { throw new Error(`[validate-env] ${name} must be a valid HTTPS URL.`); }
  if (parsed.origin !== origin || parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error(`[validate-env] ${name} must use the exact production origin.`);
  }
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

  const legacyIssuanceEnabled = validated.LICENSE_LEGACY_ISSUANCE_ENABLED?.toLowerCase() !== 'false';
  if (legacyIssuanceEnabled && !validated.LICENSE_SIGNING_KEY_ID?.trim()) {
    throw new Error(
      '[validate-env] Legacy licence issuance is enabled but LICENSE_SIGNING_KEY_ID is missing.',
    );
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

  const modeSource = {
    COMMERCIAL_MODE: validated.COMMERCIAL_MODE,
    COMMERCIAL_STRIPE_ENABLED: validated.COMMERCIAL_STRIPE_ENABLED,
    NODE_ENV: validated.NODE_ENV,
    PATROLSAFE_COMMERCIAL_STAGING: validated.PATROLSAFE_COMMERCIAL_STAGING,
  };
  const configuredMode = configuredCommercialMode(modeSource);
  const commercialMode = effectiveCommercialMode(modeSource);
  if (commercialMode !== 'DISABLED') {
    const keyPattern = commercialMode === 'STAGING_TEST' ? /^(?:sk|rk)_test_/ : /^rk_live_/;
    if (!keyPattern.test(validated.COMMERCIAL_STRIPE_SECRET_KEY ?? '')) {
      throw new Error('[validate-env] Commercial Stripe credential does not match the explicit commercial mode.');
    }
    if (!validated.COMMERCIAL_STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')) {
      throw new Error('[validate-env] Commercial payments require a Stripe webhook secret.');
    }
    if (!validated.COMMERCIAL_STRIPE_PRODUCT_ID?.startsWith('prod_')) {
      throw new Error('[validate-env] Commercial payments require a configured Stripe Product ID.');
    }
    if (!validated.COMMERCIAL_STRIPE_PRICE_ID?.startsWith('price_')) {
      throw new Error('[validate-env] Commercial payments require a configured Stripe Price ID.');
    }
    if (validated.COMMERCIAL_STRIPE_PRICE_LOOKUP_KEY !== 'patrolsafe_annual_gbp_v1') {
      throw new Error('[validate-env] Commercial Stripe Price lookup key is invalid.');
    }
    if (validated.COMMERCIAL_STRIPE_PRICE_TAX_BEHAVIOR !== 'inclusive') {
      throw new Error('[validate-env] Commercial Stripe Price tax behaviour must be explicitly inclusive.');
    }
  }
  if (validated.NODE_ENV === 'production') validateProductionIsolation(validated, configuredMode);
  if (commercialMode === 'PRODUCTION_LIVE') validateProductionCommercialContract(validated);
  if (validated.COMMERCIAL_ARTIFACT_STORE
    && !['database', 'private-test-filesystem'].includes(validated.COMMERCIAL_ARTIFACT_STORE)) {
    throw new Error('[validate-env] COMMERCIAL_ARTIFACT_STORE must be database or private-test-filesystem.');
  }
  if (isTruthy(validated.COMMERCIAL_LEAN_STAGING_PORTALS)) {
    if (!isTruthy(validated.PATROLSAFE_COMMERCIAL_STAGING)) {
      throw new Error('[validate-env] Lean portals require the explicit commercial staging marker.');
    }
    if (validated.NODE_ENV === 'production') {
      throw new Error('[validate-env] Lean staging portals are forbidden in production.');
    }
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
