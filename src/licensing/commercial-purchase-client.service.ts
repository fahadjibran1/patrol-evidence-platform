import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LICENCE_PRODUCT_NAME } from '@patrol/license-core';
import { readDesktopWorkspaceConfig } from '@/desktop/desktop-config.util';
import { InstallationIdentityService } from './installation-identity.service';

const SERVICE_TIMEOUT_MS = 10_000;
const PURCHASE_REFERENCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ORDER_ID_PATTERN = /^ord_[0-9a-f-]{36}$/i;
const AUTHORISED_COMMERCIAL_STAGING_ORIGIN = 'https://patrolsafe-commercial-staging.onrender.com';

export type CustomerPurchaseStatus =
  | 'AWAITING_PAYMENT'
  | 'AWAITING_APPROVAL'
  | 'PREPARING'
  | 'READY'
  | 'DELIVERY_PROBLEM';

interface PurchaseRequestResponse {
  requestId: string;
  publicOrderId: string;
  purchaseReference: string;
  referenceExpiresAt: string;
  status: 'REQUEST_CREATED';
}

@Injectable()
export class CommercialPurchaseClientService {
  constructor(private readonly identity: InstallationIdentityService) {}

  async start(input: {
    requestId: string;
    clientNonce: string;
    previousLicenceId?: string | null;
  }) {
    const configuration = this.configuration();
    const workspace = readDesktopWorkspaceConfig();
    const companyName = workspace.companyName?.trim();
    if (!companyName) {
      throw new BadRequestException('Complete company setup before buying a licence.');
    }
    const installation = this.identity.getOrCreateIdentity();
    const build = this.buildMetadata();
    const request = {
      requestId: input.requestId,
      schemaVersion: 2,
      product: LICENCE_PRODUCT_NAME,
      plan: 'annual',
      installationId: installation.installationId,
      machineFingerprint: installation.machineFingerprint,
      companyName,
      appVersion: build.appVersion,
      buildId: build.buildId,
      clientNonce: input.clientNonce,
      previousLicenceId: input.previousLicenceId ?? null,
    } as const;

    const result = await this.requestJson<PurchaseRequestResponse>(
      new URL('/commercial/purchase-requests', configuration.serviceOrigin),
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) },
    );
    this.assertCreatedResponse(result, input.requestId);
    const purchaseUrl = new URL(
      `/patrolsafe/buy/${encodeURIComponent(result.purchaseReference)}`,
      configuration.purchaseOrigin,
    );

    return {
      requestId: result.requestId,
      publicOrderId: result.publicOrderId,
      purchaseReference: result.purchaseReference,
      referenceExpiresAt: result.referenceExpiresAt,
      purchaseUrl: purchaseUrl.toString(),
      status: 'PURCHASE_STARTED' as const,
    };
  }

  async status(purchaseReference: string): Promise<{
    status: CustomerPurchaseStatus;
    message: string;
  }> {
    if (!PURCHASE_REFERENCE_PATTERN.test(purchaseReference)) {
      throw new BadRequestException('The saved purchase reference is not valid. Start a new purchase or use manual activation.');
    }
    const configuration = this.configuration();
    const result = await this.requestJson<Record<string, unknown>>(
      new URL('/commercial/purchase', configuration.serviceOrigin),
      { method: 'GET', headers: { authorization: `Bearer ${purchaseReference}` } },
    );
    const state = typeof result.orderState === 'string' ? result.orderState : '';
    return this.customerStatus(state);
  }

  private customerStatus(state: string): { status: CustomerPurchaseStatus; message: string } {
    if (['REQUEST_CREATED', 'CHECKOUT_PENDING', 'PAYMENT_PENDING'].includes(state)) {
      return { status: 'AWAITING_PAYMENT', message: 'Awaiting payment' };
    }
    if (state === 'PAID_AWAITING_APPROVAL') {
      return { status: 'AWAITING_APPROVAL', message: 'Payment received — awaiting approval' };
    }
    if (state === 'ISSUANCE_PENDING') {
      return { status: 'PREPARING', message: 'Licence being prepared' };
    }
    if (['ISSUED', 'DELIVERY_PENDING', 'DELIVERED'].includes(state)) {
      return { status: 'READY', message: 'Licence ready — check your email' };
    }
    return { status: 'DELIVERY_PROBLEM', message: 'Delivery problem — contact PatrolSafe support' };
  }

  private async requestJson<T>(url: URL, init: RequestInit): Promise<T> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), SERVICE_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...init, redirect: 'error', signal: abort.signal });
      if (!response.ok) {
        if (response.status === 404 || response.status === 409 || response.status === 410) {
          throw new BadRequestException('This purchase can no longer be checked. Start a new purchase or contact support.');
        }
        throw new BadGatewayException('The licensing service could not complete the request. No local entitlement was changed.');
      }
      const parsed: unknown = await response.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new BadGatewayException('The licensing service returned an invalid response.');
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof BadGatewayException) throw error;
      throw new ServiceUnavailableException(
        'The online licensing service is temporarily unavailable. Your current trial or licence is unchanged; manual activation remains available.',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private assertCreatedResponse(value: PurchaseRequestResponse, expectedRequestId: string): void {
    if (
      value.requestId !== expectedRequestId
      || value.status !== 'REQUEST_CREATED'
      || !ORDER_ID_PATTERN.test(value.publicOrderId)
      || !PURCHASE_REFERENCE_PATTERN.test(value.purchaseReference)
      || !Number.isFinite(Date.parse(value.referenceExpiresAt))
    ) {
      throw new BadGatewayException('The licensing service returned an invalid purchase response.');
    }
  }

  private configuration(): { serviceOrigin: URL; purchaseOrigin: URL } {
    const production = process.env.NODE_ENV === 'production';
    const serviceOrigin = this.parseOrigin('PATROLSAFE_COMMERCIAL_SERVICE_ORIGIN', production, true);
    const purchaseOrigin = this.parseOrigin('PATROLSAFE_COMMERCIAL_PURCHASE_ORIGIN', true, false);
    const stagingCandidate = this.isAuthorisedStagingCandidate(serviceOrigin, purchaseOrigin);
    if (production && !stagingCandidate && !this.isSfourHost(serviceOrigin.hostname)) {
      throw new ServiceUnavailableException('The online licensing service is not configured for this release.');
    }
    if (production && !stagingCandidate && !this.isSfourHost(purchaseOrigin.hostname)) {
      throw new ServiceUnavailableException('The approved PatrolSafe purchase site is not configured for this release.');
    }
    return { serviceOrigin, purchaseOrigin };
  }

  private isAuthorisedStagingCandidate(serviceOrigin: URL, purchaseOrigin: URL): boolean {
    if (
      process.env.PATROLSAFE_COMMERCIAL_STAGING !== 'true'
      || process.env.PATROLSAFE_COMMERCIAL_STAGING_BUILD !== 'true'
    ) {
      return false;
    }
    return serviceOrigin.origin === AUTHORISED_COMMERCIAL_STAGING_ORIGIN
      && purchaseOrigin.origin === AUTHORISED_COMMERCIAL_STAGING_ORIGIN;
  }

  private parseOrigin(name: string, requireHttps: boolean, allowLoopbackHttp: boolean): URL {
    const raw = process.env[name]?.trim();
    if (!raw) throw new ServiceUnavailableException('Online purchasing is not configured in this build. Use Manual / Offline activation.');
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new ServiceUnavailableException('Online purchasing is not configured safely in this build.');
    }
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname.toLowerCase());
    if (
      parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || parsed.pathname !== '/'
      || (parsed.protocol !== 'https:' && !(allowLoopbackHttp && !requireHttps && loopback))
    ) {
      throw new ServiceUnavailableException('Online purchasing is not configured safely in this build.');
    }
    return parsed;
  }

  private isSfourHost(hostname: string): boolean {
    const host = hostname.toLowerCase();
    return host === 'sfour.co.uk' || host.endsWith('.sfour.co.uk');
  }

  private buildMetadata(): { appVersion: string; buildId: string } {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require('../../package.json') as { version?: string; buildId?: string };
    return {
      appVersion: process.env.PATROL_APP_VERSION?.trim() || pkg.version || '1.0.3',
      buildId: process.env.PATROL_BUILD_ID?.trim() || pkg.buildId || 'development',
    };
  }
}
