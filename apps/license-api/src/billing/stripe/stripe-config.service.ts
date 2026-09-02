import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';

export interface StripeRuntimeConfig {
  enabled: boolean;
  secretKey: string | null;
  publishableKey: string | null;
  webhookSecret: string | null;
  apiVersion: string;
  successUrl: string;
  cancelUrl: string;
  portalReturnUrl: string;
  gracePeriodDays: number;
  currentTermsVersion: string;
  webhookMaxAttempts: number;
}

@Injectable()
export class StripeConfigService {
  constructor(private readonly config: ConfigService) {}

  getConfig(): StripeRuntimeConfig {
    const enabled = this.parseBool(this.config.get<string>('STRIPE_ENABLED'), false);
    return {
      enabled,
      secretKey: this.config.get<string>('STRIPE_SECRET_KEY') ?? null,
      publishableKey: this.config.get<string>('STRIPE_PUBLISHABLE_KEY') ?? null,
      webhookSecret: this.config.get<string>('STRIPE_WEBHOOK_SECRET') ?? null,
      apiVersion: this.config.get<string>('STRIPE_API_VERSION') ?? '2024-11-20.acacia',
      successUrl:
        this.config.get<string>('STRIPE_CHECKOUT_SUCCESS_URL')
        ?? 'http://localhost:5175/billing/checkout/success?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl:
        this.config.get<string>('STRIPE_CHECKOUT_CANCEL_URL')
        ?? 'http://localhost:5175/billing/checkout/cancelled',
      portalReturnUrl:
        this.config.get<string>('STRIPE_BILLING_PORTAL_RETURN_URL')
        ?? 'http://localhost:5175/billing',
      gracePeriodDays: Number(this.config.get<string>('BILLING_GRACE_PERIOD_DAYS') ?? '7'),
      currentTermsVersion: this.config.get<string>('BILLING_TERMS_VERSION') ?? '2026-07-01',
      webhookMaxAttempts: Number(this.config.get<string>('STRIPE_WEBHOOK_MAX_ATTEMPTS') ?? '8'),
    };
  }

  assertReadyForCheckout(): StripeRuntimeConfig {
    const cfg = this.getConfig();
    if (!cfg.enabled) {
      throw new ApiException(ERROR_CODES.STRIPE_DISABLED, 'Stripe is disabled', 503);
    }
    if (!cfg.secretKey || !cfg.webhookSecret) {
      throw new ApiException(
        ERROR_CODES.STRIPE_NOT_CONFIGURED,
        'Stripe is enabled but required secrets are missing',
        503,
      );
    }
    return cfg;
  }

  getMode(): 'TEST' | 'LIVE' | 'DISABLED' {
    const cfg = this.getConfig();
    if (!cfg.enabled || !cfg.secretKey) {
      return 'DISABLED';
    }
    return cfg.secretKey.startsWith('sk_live_') ? 'LIVE' : 'TEST';
  }

  /** Safe status for admin system page — never includes secrets. */
  getSafeStatus() {
    const cfg = this.getConfig();
    return {
      enabled: cfg.enabled,
      mode: this.getMode(),
      configured: Boolean(cfg.secretKey && cfg.webhookSecret && cfg.publishableKey),
      publishableKeyConfigured: Boolean(cfg.publishableKey),
      webhookSecretConfigured: Boolean(cfg.webhookSecret),
      gracePeriodDays: cfg.gracePeriodDays,
      currentTermsVersion: cfg.currentTermsVersion,
    };
  }

  private parseBool(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined || value === null || value === '') {
      return fallback;
    }
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
  }
}
