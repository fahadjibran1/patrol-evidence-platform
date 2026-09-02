import { Injectable } from '@nestjs/common';
import {
  ALL_BILLING_FEATURES,
  BillingFeature,
  normalizeBillingFeatures,
} from './billing-features';

@Injectable()
export class FeatureService {
  listFeatures(): BillingFeature[] {
    return [...ALL_BILLING_FEATURES];
  }

  hasFeature(includedFeatures: unknown, feature: BillingFeature): boolean {
    return normalizeBillingFeatures(includedFeatures).includes(feature);
  }

  assertKnownFeatures(features: string[]): BillingFeature[] {
    const normalized = normalizeBillingFeatures(features);
    const unknown = features.filter((f) => !normalized.includes(f as BillingFeature));
    if (unknown.length > 0) {
      throw new Error(`Unknown billing features: ${unknown.join(', ')}`);
    }
    return normalized;
  }
}
