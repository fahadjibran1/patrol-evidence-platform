import { Injectable } from '@nestjs/common';
import {
  BILLING_TO_LICENCE_FEATURES,
  BillingFeature,
  normalizeBillingFeatures,
} from './billing-features';
import { REQUIRED_LICENCE_FEATURES } from '@/licences/licence-features';

@Injectable()
export class PlanFeatureResolver {
  resolveLicenceFeatures(includedFeatures: unknown): string[] {
    const billing = normalizeBillingFeatures(includedFeatures);
    const licenceFeatures = new Set<string>(REQUIRED_LICENCE_FEATURES);

    for (const feature of billing) {
      for (const mapped of BILLING_TO_LICENCE_FEATURES[feature] ?? []) {
        licenceFeatures.add(mapped);
      }
    }

    return Array.from(licenceFeatures);
  }

  resolveBillingFeatures(includedFeatures: unknown): BillingFeature[] {
    return normalizeBillingFeatures(includedFeatures);
  }
}
