import { ConfigService } from '@nestjs/config';
import { validateEnv } from './config/validate-env';
import { CommercialConfigService } from './commercial-foundation/commercial-config.service';
import {
  COMMERCIAL_PRODUCTION_SIGNING_KEY_PATH,
  ProductionFileEd25519SigningProvider,
} from './commercial-foundation/production-file-ed25519-signing.provider';
import { ResendCommercialDeliveryProvider } from './commercial-foundation/resend-commercial-delivery.provider';
import { StripeCommercialPaymentProvider } from './commercial-foundation/stripe-commercial-payment.provider';

function safeLine(name: string, value: string | boolean): void {
  process.stdout.write(`${name}=${String(value)}\n`);
}

async function main(): Promise<void> {
  if (process.env.COMMERCIAL_PREFLIGHT_ACKNOWLEDGE_READ_ONLY !== 'true') {
    safeLine('PREFLIGHT_ACKNOWLEDGED', false);
    safeLine('PREFLIGHT_RESULT', 'FAIL');
    process.exitCode = 1;
    return;
  }

  const config = new ConfigService(process.env);
  let configurationValid = false;
  const originalWarn = console.warn;
  try {
    // Validation warnings may contain environment-derived values. The preflight
    // contract emits only the explicit safe fields below.
    console.warn = () => undefined;
    validateEnv({
      ...process.env,
      COMMERCIAL_MODE: 'PRODUCTION_LIVE',
      COMMERCIAL_STRIPE_ENABLED: 'true',
    });
    configurationValid = true;
  } catch {
    // Do not echo validation errors: environment-derived values may be sensitive.
  } finally {
    console.warn = originalWarn;
  }
  safeLine('PRODUCTION_CONFIGURATION_VALID', configurationValid);
  if (!configurationValid) {
    safeLine('PREFLIGHT_RESULT', 'FAIL');
    process.exitCode = 1;
    return;
  }

  const signer = new ProductionFileEd25519SigningProvider(config);
  const signerResult = await signer.preflight(
    COMMERCIAL_PRODUCTION_SIGNING_KEY_PATH,
    { allowDisabledProductionPreflight: true },
  );
  safeLine('SIGNER_KEY_ID', 'vesoft-online-v1');
  safeLine('SIGNER_FILE_READABLE', signerResult.fileReadable);
  safeLine('SIGNER_KEY_TYPE_VALID', signerResult.keyTypeValid);
  safeLine('SIGNER_PUBLIC_KEY_SHA256', signerResult.publicKeySha256);
  safeLine('SIGNER_PUBLIC_KEY_MATCH', signerResult.publicKeyMatch);
  safeLine('SIGNER_PREFLIGHT_PASS', signerResult.passed);

  const commercialConfig = new CommercialConfigService(config);
  let stripePassed = false;
  try {
    const stripe = await new StripeCommercialPaymentProvider(commercialConfig).productionReadOnlyPreflight();
    safeLine('STRIPE_CREDENTIAL_ACCEPTED', stripe.credentialAccepted);
    safeLine('STRIPE_API_VERSION', stripe.apiVersion);
    safeLine('STRIPE_PRODUCT_ID', stripe.productId);
    safeLine('STRIPE_PRODUCT_VALID', stripe.productValid);
    safeLine('STRIPE_PRICE_ID', stripe.priceId);
    safeLine('STRIPE_PRICE_VALID', stripe.priceValid);
    safeLine('STRIPE_TAX_RATE_ID', stripe.taxRateId);
    safeLine('STRIPE_TAX_RATE_VALID', stripe.taxRateValid);
    stripePassed = stripe.passed;
  } catch {
    safeLine('STRIPE_CREDENTIAL_ACCEPTED', false);
    safeLine('STRIPE_PREFLIGHT_ERROR', 'SAFE_READ_FAILED');
  }
  safeLine('STRIPE_PREFLIGHT_PASS', stripePassed);

  const resend = new ResendCommercialDeliveryProvider(config).configurationPreflight();
  safeLine('RESEND_ENABLED', resend.enabled);
  safeLine('RESEND_API_KEY_FORMAT_VALID', resend.apiKeyFormatValid);
  safeLine('RESEND_SENDER_FORMAT_VALID', resend.senderFormatValid);
  safeLine('RESEND_WEBHOOK_SECRET_FORMAT_VALID', resend.webhookSecretFormatValid);
  safeLine('RESEND_NETWORK_VERIFICATION_PERFORMED', false);
  safeLine('RESEND_CONFIGURATION_PASS', resend.passed);

  const passed = signerResult.passed && stripePassed && resend.passed;
  safeLine('PREFLIGHT_MUTATIONS_PERFORMED', false);
  safeLine('PREFLIGHT_RESULT', passed ? 'PASS' : 'FAIL');
  if (!passed) process.exitCode = 1;
}

void main().catch(() => {
  safeLine('PREFLIGHT_UNEXPECTED_ERROR', 'SAFE_FAILURE');
  safeLine('PREFLIGHT_RESULT', 'FAIL');
  process.exitCode = 1;
});
