import { BadGatewayException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  emitCommercialPurchaseDiagnostic,
  runCommercialPurchaseFlow,
  safeCommercialPurchaseError,
  type CommercialPurchaseDiagnosticStage,
  type CommercialPurchaseSession,
} from '../../web/src/lib/commercial-purchase-flow';
import { formatCommercialDiagnostic, safeCommercialError } from './commercial-purchase-diagnostic';

describe('commercial purchase diagnostic instrumentation', () => {
  const requestId = '5c97ec6e-77af-4fbe-8928-6ba4931eb213';
  const reference = 'R'.repeat(43);
  const pending: CommercialPurchaseSession = {
    requestId,
    clientNonce: 'N'.repeat(64),
    previousLicenceId: null,
    referenceExpiresAt: '2026-09-25T13:00:00.000Z',
  };

  function setup(overrides: Record<string, unknown> = {}) {
    const diagnostics: Array<{ stage: CommercialPurchaseDiagnosticStage; fields?: object }> = [];
    let persistCount = 0;
    const dependencies = {
      existingSession: null,
      previousLicenceId: null,
      now: () => Date.parse('2026-09-25T12:00:00.000Z'),
      createRequestId: () => requestId,
      createClientNonce: () => 'N'.repeat(64),
      clearSession: jest.fn(async () => undefined),
      persistSession: jest.fn(async () => { persistCount += 1; }),
      requestPurchase: jest.fn(async () => ({
        requestId,
        publicOrderId: 'ord_74cc812c-4abf-4f06-a57e-3a4c1ad6ce27',
        purchaseReference: reference,
        referenceExpiresAt: '2026-09-25T13:00:00.000Z',
        purchaseUrl: `https://patrolsafe-commercial-staging.onrender.com/patrolsafe/buy/${reference}`,
        status: 'PURCHASE_STARTED' as const,
      })),
      openPurchase: jest.fn(async () => true),
      emit: (stage: CommercialPurchaseDiagnosticStage, fields?: object) => diagnostics.push({ stage, fields }),
      ...overrides,
    };
    return { dependencies, diagnostics, getPersistCount: () => persistCount };
  }

  it('records the successful renderer stage progression without identifiers', async () => {
    const { dependencies, diagnostics } = setup();
    await expect(runCommercialPurchaseFlow(dependencies)).resolves.toMatchObject({ resumed: false });
    expect(diagnostics.map(({ stage }) => stage)).toEqual([
      'BUY_HANDLER_STARTED',
      'PENDING_PURCHASE_SESSION_SAVE_STARTED',
      'PENDING_PURCHASE_SESSION_SAVE_SUCCEEDED',
      'LOCAL_COMMERCIAL_PURCHASE_REQUEST_STARTED',
      'LOCAL_COMMERCIAL_PURCHASE_REQUEST_SUCCEEDED',
      'PURCHASE_REFERENCE_PERSIST_STARTED',
      'PURCHASE_REFERENCE_PERSIST_SUCCEEDED',
      'BROWSER_HANDOFF_STARTED',
      'BROWSER_HANDOFF_SUCCEEDED',
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain(requestId);
    expect(JSON.stringify(diagnostics)).not.toContain(reference);
    expect(JSON.stringify(diagnostics)).not.toContain('N'.repeat(64));
  });

  it.each([
    ['pending-session storage', 'PENDING_PURCHASE_SESSION_SAVE_FAILED', (base: ReturnType<typeof setup>['dependencies']) => {
      base.persistSession = jest.fn(async () => { throw new Error('secret-pending'); });
    }],
    ['local API', 'LOCAL_COMMERCIAL_PURCHASE_REQUEST_FAILED', (base: ReturnType<typeof setup>['dependencies']) => {
      base.requestPurchase = jest.fn(async () => { throw Object.assign(new Error('secret-local'), { status: 503 }); });
    }],
    ['reference persistence', 'PURCHASE_REFERENCE_PERSIST_FAILED', (base: ReturnType<typeof setup>['dependencies']) => {
      let calls = 0;
      base.persistSession = jest.fn(async () => {
        calls += 1;
        if (calls === 2) throw new Error('secret-reference');
      });
    }],
    ['browser handoff', 'BROWSER_HANDOFF_FAILED', (base: ReturnType<typeof setup>['dependencies']) => {
      base.openPurchase = jest.fn(async () => false);
    }],
  ])('identifies %s failure and preserves entitlement state', async (_label, failedStage, mutate) => {
    const entitlement = Object.freeze({ mode: 'trial', expiresAt: '2026-10-25T10:35:34.536Z' });
    const { dependencies, diagnostics } = setup();
    mutate(dependencies);
    await expect(runCommercialPurchaseFlow(dependencies)).rejects.toBeDefined();
    expect(diagnostics.map(({ stage }) => stage)).toContain(failedStage as CommercialPurchaseDiagnosticStage);
    expect(diagnostics.at(-1)).toMatchObject({
      stage: 'BUY_HANDLER_FAILED',
      fields: { failureStage: failedStage },
    });
    expect(entitlement).toEqual({ mode: 'trial', expiresAt: '2026-10-25T10:35:34.536Z' });
  });

  it('retains duplicate-purchase protection by resuming a valid stored purchase', async () => {
    const existing = { ...pending, purchaseReference: reference, purchaseUrl: `https://patrolsafe-commercial-staging.onrender.com/patrolsafe/buy/${reference}` };
    const { dependencies, diagnostics } = setup({ existingSession: existing });
    await expect(runCommercialPurchaseFlow(dependencies)).resolves.toMatchObject({ resumed: true });
    expect(dependencies.persistSession).not.toHaveBeenCalled();
    expect(dependencies.requestPurchase).not.toHaveBeenCalled();
    expect(dependencies.openPurchase).toHaveBeenCalledTimes(1);
    expect(diagnostics.map(({ stage }) => stage)).toEqual([
      'BUY_HANDLER_STARTED', 'BROWSER_HANDOFF_STARTED', 'BROWSER_HANDOFF_SUCCEEDED',
    ]);
  });

  it('emits only allowlisted error class/code fields and never error messages', () => {
    const secretValues = [
      'installation-secret', 'fingerprint-secret', 'nonce-secret', 'opaque-reference-secret',
      'bearer-secret', 'jwt-secret', 'email@example.test', 'password-secret', 'licence-secret',
      'PAYMENT_KEY_MARKER', 'WEBHOOK_MARKER', 'DATABASE_URL_MARKER', 'PRIVATE_SIGNING_KEY_MARKER',
    ];
    const consoleSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    emitCommercialPurchaseDiagnostic('BUY_HANDLER_FAILED', {
      failureStage: 'LOCAL_COMMERCIAL_PURCHASE_REQUEST_FAILED',
      ...safeCommercialPurchaseError(new Error(secretValues.join('|'))),
    });
    const line = String(consoleSpy.mock.calls[0][0]);
    for (const secret of secretValues) expect(line).not.toContain(secret);
    expect(line).toContain('errorClass=ERROR errorCode=UNCLASSIFIED');

    const backendLine = formatCommercialDiagnostic(
      'RENDER_PURCHASE_REQUEST_FAILED',
      safeCommercialError(new BadGatewayException(secretValues.join('|'))),
    );
    for (const secret of secretValues) expect(backendLine).not.toContain(secret);
    expect(backendLine).toContain('errorClass=HTTP_EXCEPTION errorCode=HTTP_502');
  });

  it('keeps the customer message generic and local API resolution dynamic after backend restart', () => {
    const page = readFileSync(join(process.cwd(), 'web/src/pages/license-page.tsx'), 'utf8');
    const api = readFileSync(join(process.cwd(), 'web/src/lib/api.ts'), 'utf8');
    expect(page).toContain('Online purchasing is currently unavailable. Your trial or current licence unchanged.');
    expect(page).not.toContain('error.message');
    expect(api).toContain('const desktopBaseUrl = await resolveDesktopApiBaseUrl();');
    expect(api).toContain("fetch(`${await resolveApiBaseUrl()}${path}`");
    expect(api).toContain('createTimedSignal(init.signal, timeoutMs)');
    expect(api).toContain('{ ...options, skipRefresh: true }');
    expect(page).toContain('const COMMERCIAL_PURCHASE_LOCAL_API_TIMEOUT_MS = 100_000;');
    expect(page).toContain('{ timeoutMs: COMMERCIAL_PURCHASE_LOCAL_API_TIMEOUT_MS }');
  });
});
