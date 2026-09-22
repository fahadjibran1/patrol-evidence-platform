import { readFileSync } from 'fs';
import { join } from 'path';

function source(relative: string): string {
  return readFileSync(join(process.cwd(), relative), 'utf8');
}

describe('PatrolSafe v1.0.3 commercial desktop contract', () => {
  const page = source('web/src/pages/license-page.tsx');
  const client = source('src/licensing/commercial-purchase-client.service.ts');
  const policy = source('desktop/security-policy.js');
  const durability = source('desktop/data-durability.js');

  it('makes online annual purchase primary and keeps offline activation available', () => {
    for (const text of ['PatrolSafe Trial', 'Buy annual licence', 'Renew licence', '£299', '+ VAT where applicable', '1 Windows workstation', '12-month licence', 'Manual / Offline activation', 'Create licence request (.tgreq)', 'Activate supplied licence (.tglic)']) {
      expect(page).toContain(text);
    }
  });

  it('shows precise expiry and bounded trial/commercial warning thresholds', () => {
    expect(page).toContain('formatPatrolDateTime(status.expiresAt)');
    for (const days of ['within 1 day', 'within 3 days', 'within 7 days', 'within 30 days', 'within 90 days']) {
      expect(page).toContain(days);
    }
    expect(page).toContain('no automatic charge');
  });

  it('constructs PurchaseRequestV2 on the trusted desktop backend without payment authority', () => {
    for (const value of ['schemaVersion: 2', 'product: LICENCE_PRODUCT_NAME', "plan: 'annual'", 'installationId:', 'machineFingerprint:', 'companyName,', 'appVersion:', 'buildId:', 'clientNonce:', 'previousLicenceId:']) {
      expect(client).toContain(value);
    }
    for (const prohibited of ['stripePriceId', 'paymentStatus', 'amountMinor:', 'currency:']) {
      expect(client).not.toContain(prohibited);
    }
  });

  it('uses encrypted restart recovery and a fixed opaque-reference browser destination', () => {
    expect(source('web/src/lib/desktop.ts')).toContain("secureStoreSet?.('commercial-purchase-session'");
    expect(page).toContain('currentSession?.purchaseUrl');
    expect(policy).toContain("/^\\/patrolsafe\\/buy\\/[A-Za-z0-9_-]{43}$/");
    expect(policy).toContain("target.protocol !== 'https:'");
    expect(policy).toContain('target.origin !== approved.origin');
    expect(source('desktop/main.js')).toContain("handleTrusted('desktop:open-commercial-purchase'");
  });

  it('does not infer payment or entitlement from browser handoff', () => {
    expect(page).toContain('Purchase started');
    expect(page).toContain('Check licence status');
    expect(page).toContain('PatrolSafe will not activate until you import the supplied licence');
    expect(page).toContain('await reconcileEntitlement(next);');
  });

  it('adds the commercial licence only to same-machine backup state', () => {
    expect(durability).toContain("'commercial-licence.tglic'");
    expect(durability).toContain('validateCommercialLicenceRestore');
    expect(durability).toContain('requiresLicenceRecovery');
    expect(durability).toContain("portability: 'SAME_MACHINE_ONLY'");
  });

  it('keeps the production online trust entry pending and rejects unknown signatures', () => {
    const keys = source('src/licensing/license-public-key.util.ts');
    const crypto = source('packages/license-core/src/commercial-crypto.ts');
    expect(keys).toContain('LICENSE_ONLINE_PUBLIC_KEY_FILE');
    expect(keys).not.toContain('test-phase3');
    expect(crypto).toContain("policy: 'legacy-v1' | 'online-annual-v1'");
    expect(crypto).toContain("reason: 'Licence signature is not trusted.'");
    expect(crypto).toContain("verification.payload.product !==");
  });
});
