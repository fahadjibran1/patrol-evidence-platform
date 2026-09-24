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
  COMMERCIAL_TAX_POLICY,
} from './commercial.constants';

export interface CommercialPolicy {
  product: typeof COMMERCIAL_PRODUCT;
  displayName: typeof COMMERCIAL_PRODUCT_DISPLAY_NAME;
  plan: typeof COMMERCIAL_PLAN;
  amountMinor: typeof COMMERCIAL_ANNUAL_AMOUNT_MINOR;
  currency: typeof COMMERCIAL_CURRENCY;
  maxDevices: typeof COMMERCIAL_MAX_DEVICES;
  taxPolicy: typeof COMMERCIAL_TAX_POLICY;
  termsVersion: string;
  privacyVersion: string;
  billingAddressCollection: 'required';
  taxIdCollectionEnabled: false;
  automaticTaxEnabled: false;
  invoiceCreationEnabled: false;
}

export interface CommercialStripeTestConfig {
  enabled: boolean;
  secretKey: string | null;
  webhookSecret: string | null;
  productId: string | null;
  priceId: string | null;
  priceLookupKey: string | null;
  priceTaxBehavior: 'inclusive' | null;
  apiVersion: string;
  successUrlTemplate: string;
  cancelUrlTemplate: string;
}

@Injectable()
export class CommercialConfigService {
  constructor(private readonly config: ConfigService) {}

  getPolicy(): Readonly<CommercialPolicy> {
    return Object.freeze({
      product: COMMERCIAL_PRODUCT,
      displayName: COMMERCIAL_PRODUCT_DISPLAY_NAME,
      plan: COMMERCIAL_PLAN,
      amountMinor: COMMERCIAL_ANNUAL_AMOUNT_MINOR,
      currency: COMMERCIAL_CURRENCY,
      maxDevices: COMMERCIAL_MAX_DEVICES,
      taxPolicy: COMMERCIAL_TAX_POLICY,
      termsVersion: this.config.get<string>('COMMERCIAL_TERMS_VERSION') ?? 'pending-commercial-approval',
      privacyVersion: this.config.get<string>('COMMERCIAL_PRIVACY_VERSION') ?? 'pending-commercial-approval',
      billingAddressCollection: 'required',
      taxIdCollectionEnabled: false,
      automaticTaxEnabled: false,
      invoiceCreationEnabled: false,
    });
  }

  getStripeTestConfig(): CommercialStripeTestConfig {
    return {
      enabled: this.parseBool(this.config.get<string>('COMMERCIAL_STRIPE_ENABLED')),
      secretKey: this.config.get<string>('COMMERCIAL_STRIPE_SECRET_KEY') ?? null,
      webhookSecret: this.config.get<string>('COMMERCIAL_STRIPE_WEBHOOK_SECRET') ?? null,
      productId: this.config.get<string>('COMMERCIAL_STRIPE_PRODUCT_ID') ?? null,
      priceId: this.config.get<string>('COMMERCIAL_STRIPE_PRICE_ID') ?? null,
      priceLookupKey: this.config.get<string>('COMMERCIAL_STRIPE_PRICE_LOOKUP_KEY') ?? null,
      priceTaxBehavior: this.config.get<string>('COMMERCIAL_STRIPE_PRICE_TAX_BEHAVIOR') === 'inclusive'
        ? 'inclusive'
        : null,
      apiVersion: this.config.get<string>('COMMERCIAL_STRIPE_API_VERSION') ?? '2024-11-20.acacia',
      successUrlTemplate:
        this.config.get<string>('COMMERCIAL_CHECKOUT_SUCCESS_URL')
        ?? 'https://www.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}?checkout=success',
      cancelUrlTemplate:
        this.config.get<string>('COMMERCIAL_CHECKOUT_CANCEL_URL')
        ?? 'https://www.sfour.co.uk/patrolsafe/licence/status/{ORDER_REFERENCE}?checkout=cancelled',
    };
  }

  assertStripeTestReady(): CommercialStripeTestConfig {
    const stripe = this.getStripeTestConfig();
    if (!stripe.enabled) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_STRIPE_DISABLED, 'Commercial Stripe test mode is disabled.', 503);
    }
    if (!/^(?:sk|rk)_test_/.test(stripe.secretKey ?? '') || !stripe.webhookSecret?.startsWith('whsec_')) {
      throw new ApiException(
        ERROR_CODES.COMMERCIAL_STRIPE_NOT_CONFIGURED,
        'Commercial Stripe test configuration is incomplete or not test mode.',
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
    return stripe;
  }

  isOutboxWorkerEnabled(): boolean {
    return this.parseBool(this.config.get<string>('COMMERCIAL_OUTBOX_WORKER_ENABLED'));
  }

  renderRedirectUrl(template: string, publicOrderId: string): string {
    return template.replace('{ORDER_REFERENCE}', encodeURIComponent(publicOrderId));
  }

  private isSafeCheckoutRedirect(template: string): boolean {
    try {
      const candidate = new URL(template.replace('{ORDER_REFERENCE}', 'ord_test'));
      if (candidate.protocol !== 'https:' || candidate.port || candidate.username || candidate.password) return false;
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

  private parseBool(value: string | undefined): boolean {
    return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase());
  }
}
