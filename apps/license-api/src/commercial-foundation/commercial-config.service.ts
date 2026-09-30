import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import {
  COMMERCIAL_ANNUAL_AMOUNT_MINOR,
  COMMERCIAL_CURRENCY,
  COMMERCIAL_MAX_DEVICES,
  COMMERCIAL_PLAN,
  COMMERCIAL_PRODUCT,
  COMMERCIAL_PRODUCT_DISPLAY_NAME,
  COMMERCIAL_STRIPE_PRODUCTION_API_VERSION,
  COMMERCIAL_STRIPE_STAGING_API_VERSION,
  COMMERCIAL_TAX_POLICY,
} from './commercial.constants';
import {
  configuredCommercialMode,
  effectiveCommercialMode,
  expectedLivemodeFor,
  isTruthy,
  providerModeFor,
  type CommercialMode,
  type CommercialProviderRuntimeMode,
} from './commercial-mode';

export interface CommercialPolicy {
  product: typeof COMMERCIAL_PRODUCT;
  displayName: typeof COMMERCIAL_PRODUCT_DISPLAY_NAME;
  plan: typeof COMMERCIAL_PLAN;
  amountMinor: typeof COMMERCIAL_ANNUAL_AMOUNT_MINOR;
  currency: typeof COMMERCIAL_CURRENCY;
  maxDevices: typeof COMMERCIAL_MAX_DEVICES;
  taxPolicy: string;
  termsVersion: string;
  privacyVersion: string;
  billingAddressCollection: 'required';
  taxIdCollectionEnabled: false;
  automaticTaxEnabled: false;
  invoiceCreationEnabled: boolean;
  ukBusinessOnly: boolean;
}

export interface CommercialStripeConfig {
  enabled: boolean;
  commercialMode: CommercialMode;
  providerMode: CommercialProviderRuntimeMode;
  expectedLivemode: boolean | null;
  secretKey: string | null;
  webhookSecret: string | null;
  productId: string | null;
  priceId: string | null;
  priceLookupKey: string | null;
  priceTaxBehavior: 'inclusive' | null;
  apiVersion: string;
  successUrlTemplate: string;
  cancelUrlTemplate: string;
  invoiceCreationEnabled: boolean;
  taxRateId: string | null;
  ukBusinessOnly: boolean;
}

@Injectable()
export class CommercialConfigService {
  constructor(private readonly config: ConfigService) {}

  getPolicy(): Readonly<CommercialPolicy> {
    const stripe = this.getStripeConfig();
    return Object.freeze({
      product: COMMERCIAL_PRODUCT,
      displayName: COMMERCIAL_PRODUCT_DISPLAY_NAME,
      plan: COMMERCIAL_PLAN,
      amountMinor: COMMERCIAL_ANNUAL_AMOUNT_MINOR,
      currency: COMMERCIAL_CURRENCY,
      maxDevices: COMMERCIAL_MAX_DEVICES,
      taxPolicy: stripe.commercialMode === 'PRODUCTION_LIVE'
        && this.parseBool(this.config.get<string>('COMMERCIAL_VAT_CONFIGURATION_APPROVED'))
        ? 'UK_STANDARD_VAT_INCLUSIVE'
        : COMMERCIAL_TAX_POLICY,
      termsVersion: this.config.get<string>('COMMERCIAL_TERMS_VERSION') ?? 'pending-commercial-approval',
      privacyVersion: this.config.get<string>('COMMERCIAL_PRIVACY_VERSION') ?? 'pending-commercial-approval',
      billingAddressCollection: 'required',
      taxIdCollectionEnabled: false,
      automaticTaxEnabled: false,
      invoiceCreationEnabled: stripe.invoiceCreationEnabled,
      ukBusinessOnly: stripe.ukBusinessOnly,
    });
  }

  getConfiguredMode(): CommercialMode {
    return configuredCommercialMode(this.modeSource());
  }

  getMode(): CommercialMode {
    return effectiveCommercialMode(this.modeSource());
  }

  getProviderMode(): CommercialProviderRuntimeMode {
    return providerModeFor(this.getMode());
  }

  getStripeConfig(): CommercialStripeConfig {
    const commercialMode = this.getMode();
    return {
      enabled: this.parseBool(this.config.get<string>('COMMERCIAL_STRIPE_ENABLED')),
      commercialMode,
      providerMode: providerModeFor(commercialMode),
      expectedLivemode: commercialMode === 'DISABLED' ? null : expectedLivemodeFor(commercialMode),
      secretKey: this.config.get<string>('COMMERCIAL_STRIPE_SECRET_KEY') ?? null,
      webhookSecret: this.config.get<string>('COMMERCIAL_STRIPE_WEBHOOK_SECRET') ?? null,
      productId: this.config.get<string>('COMMERCIAL_STRIPE_PRODUCT_ID') ?? null,
      priceId: this.config.get<string>('COMMERCIAL_STRIPE_PRICE_ID') ?? null,
      priceLookupKey: this.config.get<string>('COMMERCIAL_STRIPE_PRICE_LOOKUP_KEY') ?? null,
      priceTaxBehavior: this.config.get<string>('COMMERCIAL_STRIPE_PRICE_TAX_BEHAVIOR') === 'inclusive'
        ? 'inclusive'
        : null,
      apiVersion: this.config.get<string>('COMMERCIAL_STRIPE_API_VERSION')
        ?? (commercialMode === 'PRODUCTION_LIVE'
          ? COMMERCIAL_STRIPE_PRODUCTION_API_VERSION
          : COMMERCIAL_STRIPE_STAGING_API_VERSION),
      successUrlTemplate:
        this.config.get<string>('COMMERCIAL_CHECKOUT_SUCCESS_URL')
        ?? 'https://www.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}?checkout=success',
      cancelUrlTemplate:
        this.config.get<string>('COMMERCIAL_CHECKOUT_CANCEL_URL')
        ?? 'https://www.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}?checkout=cancelled',
      invoiceCreationEnabled: this.parseBool(this.config.get<string>('COMMERCIAL_STRIPE_INVOICE_CREATION_ENABLED')),
      taxRateId: this.config.get<string>('COMMERCIAL_STRIPE_TAX_RATE_ID')?.trim() || null,
      ukBusinessOnly: this.parseBool(this.config.get<string>('COMMERCIAL_UK_ONLY_ENABLED')),
    };
  }

  /** Compatibility accessor for existing staging callers and tests. */
  getStripeTestConfig(): CommercialStripeConfig {
    return this.getStripeConfig();
  }

  assertStripeReady(): CommercialStripeConfig {
    const stripe = this.getStripeConfig();
    if (!stripe.enabled) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_STRIPE_DISABLED, 'Commercial payments are disabled.', 503);
    }
    const keyPattern = stripe.commercialMode === 'STAGING_TEST'
      ? /^(?:sk|rk)_test_/
      : stripe.commercialMode === 'PRODUCTION_LIVE'
        ? /^rk_live_/
        : /a^/;
    if (!keyPattern.test(stripe.secretKey ?? '') || !stripe.webhookSecret?.startsWith('whsec_')) {
      throw new ApiException(
        ERROR_CODES.COMMERCIAL_STRIPE_NOT_CONFIGURED,
        'Commercial Stripe configuration is incomplete or does not match the explicit commercial mode.',
        503,
      );
    }
    if (
      !stripe.productId?.startsWith('prod_')
      || !stripe.priceId?.startsWith('price_')
      || !stripe.priceLookupKey
      || stripe.priceTaxBehavior !== 'inclusive'
    ) {
      throw new ApiException(
        ERROR_CODES.COMMERCIAL_STRIPE_NOT_CONFIGURED,
        'Commercial Stripe Product/Price binding is incomplete or invalid.',
        503,
      );
    }
    if (!this.isSafeCheckoutRedirect(stripe.successUrlTemplate) || !this.isSafeCheckoutRedirect(stripe.cancelUrlTemplate)) {
      throw new ApiException(
        ERROR_CODES.COMMERCIAL_STRIPE_NOT_CONFIGURED,
        'Commercial checkout redirect configuration is not an approved HTTPS portal URL.',
        503,
      );
    }
    if (stripe.commercialMode === 'PRODUCTION_LIVE') {
      const vatApproved = this.parseBool(this.config.get<string>('COMMERCIAL_VAT_CONFIGURATION_APPROVED'));
      if (
        stripe.apiVersion !== COMMERCIAL_STRIPE_PRODUCTION_API_VERSION
        || !stripe.ukBusinessOnly
        || !vatApproved
        || !stripe.invoiceCreationEnabled
        || !stripe.taxRateId?.startsWith('txr_')
      ) {
        throw new ApiException(
          ERROR_CODES.COMMERCIAL_STRIPE_NOT_CONFIGURED,
          'Production commercial Stripe API, tax, UK scope, and invoice configuration are not approved.',
          503,
        );
      }
    }
    return stripe;
  }

  /** Compatibility assertion retained for the staging-only Phase 6 contract. */
  assertStripeTestReady(): CommercialStripeConfig {
    const stripe = this.assertStripeReady();
    if (stripe.commercialMode !== 'STAGING_TEST') {
      throw new ApiException(
        ERROR_CODES.COMMERCIAL_STRIPE_NOT_CONFIGURED,
        'Commercial Stripe is not in staging test mode.',
        503,
      );
    }
    return stripe;
  }

  isOutboxWorkerEnabled(): boolean {
    return this.parseBool(this.config.get<string>('COMMERCIAL_OUTBOX_WORKER_ENABLED'));
  }

  renderRedirectUrl(template: string, publicOrderId: string): string {
    return template.replace('{ORDER_REFERENCE}', encodeURIComponent(publicOrderId));
  }

  private isSafeCheckoutRedirect(template: string): boolean {
    if ((template.match(/\{ORDER_REFERENCE\}/g)?.length ?? 0) !== 1) return false;
    try {
      const candidate = new URL(template.replace('{ORDER_REFERENCE}', 'ord_test'));
      if (candidate.protocol !== 'https:' || candidate.port || candidate.username || candidate.password) return false;

      if (this.getConfiguredMode() === 'PRODUCTION_LIVE') {
        const serviceOrigin = new URL(this.config.get<string>('COMMERCIAL_SERVICE_ORIGIN')?.trim() ?? '');
        if (!this.isApprovedProductionOrigin(serviceOrigin)) return false;
        return candidate.origin === serviceOrigin.origin;
      }

      if (candidate.hostname === 'sfour.co.uk' || candidate.hostname.endsWith('.sfour.co.uk')) return true;
      if (
        this.config.get<string>('NODE_ENV') !== 'staging'
        || !this.parseBool(this.config.get<string>('PATROLSAFE_COMMERCIAL_STAGING'))
        || !this.parseBool(this.config.get<string>('COMMERCIAL_LEAN_STAGING_PORTALS'))
      ) {
        return false;
      }

      const configuredOrigin = this.config.get<string>('CUSTOMER_PORTAL_ORIGIN')?.trim() ?? '';
      const customerPortal = new URL(configuredOrigin);
      if (
        customerPortal.protocol !== 'https:'
        || customerPortal.username
        || customerPortal.password
        || customerPortal.pathname !== '/'
        || customerPortal.search
        || customerPortal.hash
      ) {
        return false;
      }
      return candidate.origin === customerPortal.origin;
    } catch {
      return false;
    }
  }

  private isApprovedProductionOrigin(url: URL): boolean {
    const hostname = url.hostname.toLowerCase();
    return url.protocol === 'https:'
      && !url.port
      && !url.username
      && !url.password
      && url.pathname === '/'
      && !url.search
      && !url.hash
      && (hostname === 'sfour.co.uk' || hostname.endsWith('.sfour.co.uk'))
      && !hostname.includes('staging')
      && !hostname.endsWith('.onrender.com');
  }

  private modeSource() {
    return {
      COMMERCIAL_MODE: this.config.get<string>('COMMERCIAL_MODE'),
      COMMERCIAL_STRIPE_ENABLED: this.config.get<string>('COMMERCIAL_STRIPE_ENABLED'),
      NODE_ENV: this.config.get<string>('NODE_ENV'),
      PATROLSAFE_COMMERCIAL_STAGING: this.config.get<string>('PATROLSAFE_COMMERCIAL_STAGING'),
    };
  }

  private parseBool(value: string | undefined): boolean {
    return isTruthy(value);
  }
}
