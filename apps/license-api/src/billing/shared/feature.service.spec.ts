import { BillingFeature, normalizeBillingFeatures } from './billing-features';
import { FeatureService } from './feature.service';
import { PlanFeatureResolver } from './plan-feature-resolver';

describe('FeatureService', () => {
  const service = new FeatureService();

  it('lists all billing features', () => {
    expect(service.listFeatures()).toContain(BillingFeature.HAZARD_DETECTION);
    expect(service.listFeatures().length).toBeGreaterThanOrEqual(8);
  });

  it('checks feature inclusion', () => {
    expect(service.hasFeature(['MULTI_USER', 'API_ACCESS'], BillingFeature.MULTI_USER)).toBe(true);
    expect(service.hasFeature(['MULTI_USER'], BillingFeature.WHITE_LABEL)).toBe(false);
  });

  it('rejects unknown features', () => {
    expect(() => service.assertKnownFeatures(['NOT_A_FEATURE'])).toThrow(/Unknown billing features/);
  });
});

describe('PlanFeatureResolver', () => {
  const resolver = new PlanFeatureResolver();

  it('maps billing features to TG1 licence features and keeps required collector', () => {
    const features = resolver.resolveLicenceFeatures([
      BillingFeature.ADVANCED_REPORTING,
      BillingFeature.HAZARD_DETECTION,
    ]);
    expect(features).toEqual(expect.arrayContaining(['collector', 'reports', 'csv-export', 'alerts']));
  });

  it('normalizes billing feature lists', () => {
    expect(normalizeBillingFeatures(['MULTI_USER', 'MULTI_USER', 'bogus'])).toEqual([
      BillingFeature.MULTI_USER,
    ]);
  });
});
