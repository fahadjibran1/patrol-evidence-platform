export type CommercialPurchaseDiagnosticStage =
  | 'BUY_HANDLER_STARTED'
  | 'PENDING_PURCHASE_SESSION_SAVE_STARTED'
  | 'PENDING_PURCHASE_SESSION_SAVE_SUCCEEDED'
  | 'PENDING_PURCHASE_SESSION_SAVE_FAILED'
  | 'LOCAL_COMMERCIAL_PURCHASE_REQUEST_STARTED'
  | 'LOCAL_COMMERCIAL_PURCHASE_REQUEST_SUCCEEDED'
  | 'LOCAL_COMMERCIAL_PURCHASE_REQUEST_FAILED'
  | 'PURCHASE_REFERENCE_PERSIST_STARTED'
  | 'PURCHASE_REFERENCE_PERSIST_SUCCEEDED'
  | 'PURCHASE_REFERENCE_PERSIST_FAILED'
  | 'BROWSER_HANDOFF_STARTED'
  | 'BROWSER_HANDOFF_SUCCEEDED'
  | 'BROWSER_HANDOFF_FAILED'
  | 'BUY_HANDLER_FAILED';

export interface CommercialPurchaseSession {
  requestId: string;
  clientNonce: string;
  previousLicenceId: string | null;
  purchaseReference?: string;
  purchaseUrl?: string;
  referenceExpiresAt: string;
}

export interface CommercialPurchaseStartedResponse {
  requestId: string;
  publicOrderId: string;
  purchaseReference: string;
  referenceExpiresAt: string;
  purchaseUrl: string;
  status: 'PURCHASE_STARTED';
}

interface SafeDiagnosticFields {
  failureStage?: CommercialPurchaseDiagnosticStage;
  errorClass?: 'API_ERROR' | 'TYPE_ERROR' | 'ABORT_ERROR' | 'ERROR' | 'UNKNOWN_ERROR';
  errorCode?: string;
}

interface PurchaseFlowDependencies {
  existingSession: CommercialPurchaseSession | null;
  previousLicenceId: string | null;
  now: () => number;
  createRequestId: () => string;
  createClientNonce: () => string;
  clearSession: () => Promise<void>;
  persistSession: (session: CommercialPurchaseSession) => Promise<void>;
  requestPurchase: (pending: CommercialPurchaseSession) => Promise<CommercialPurchaseStartedResponse>;
  openPurchase: (purchaseUrl: string) => Promise<boolean>;
  emit?: (stage: CommercialPurchaseDiagnosticStage, fields?: SafeDiagnosticFields) => void;
}

export interface PurchaseFlowResult {
  session: CommercialPurchaseSession;
  resumed: boolean;
}

const SAFE_NODE_CODES = new Set([
  'ABORT_ERR',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
]);

export function safeCommercialPurchaseError(error: unknown): Pick<SafeDiagnosticFields, 'errorClass' | 'errorCode'> {
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : Number.NaN;
  const rawCode = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;
  const errorCode = Number.isInteger(status) && status >= 0 && status <= 599
    ? `HTTP_${status}`
    : typeof rawCode === 'string' && SAFE_NODE_CODES.has(rawCode)
      ? rawCode
      : 'UNCLASSIFIED';

  if (error instanceof TypeError) return { errorClass: 'TYPE_ERROR', errorCode };
  if (error instanceof Error && error.name === 'AbortError') return { errorClass: 'ABORT_ERROR', errorCode: 'ABORT_ERR' };
  if (error instanceof Error && error.constructor.name === 'ApiError') return { errorClass: 'API_ERROR', errorCode };
  if (error instanceof Error) return { errorClass: 'ERROR', errorCode };
  return { errorClass: 'UNKNOWN_ERROR', errorCode };
}

export function emitCommercialPurchaseDiagnostic(
  stage: CommercialPurchaseDiagnosticStage,
  fields: SafeDiagnosticFields = {},
): void {
  const suffix = [
    fields.failureStage ? `failureStage=${fields.failureStage}` : null,
    fields.errorClass ? `errorClass=${fields.errorClass}` : null,
    fields.errorCode ? `errorCode=${fields.errorCode}` : null,
  ].filter(Boolean).join(' ');
  console.info(`[commercial-purchase-diagnostic] stage=${stage}${suffix ? ` ${suffix}` : ''}`);
}

export async function runCommercialPurchaseFlow(
  dependencies: PurchaseFlowDependencies,
): Promise<PurchaseFlowResult> {
  const emit = dependencies.emit ?? emitCommercialPurchaseDiagnostic;
  let failureStage: CommercialPurchaseDiagnosticStage = 'BUY_HANDLER_STARTED';
  emit('BUY_HANDLER_STARTED');

  try {
    const currentSession = dependencies.existingSession
      && Date.parse(dependencies.existingSession.referenceExpiresAt) > dependencies.now()
      ? dependencies.existingSession
      : null;
    if (!currentSession && dependencies.existingSession) await dependencies.clearSession();

    if (currentSession?.purchaseUrl && currentSession.purchaseReference) {
      failureStage = 'BROWSER_HANDOFF_FAILED';
      emit('BROWSER_HANDOFF_STARTED');
      try {
        if (!(await dependencies.openPurchase(currentSession.purchaseUrl))) throw new Error('BROWSER_HANDOFF_REJECTED');
        emit('BROWSER_HANDOFF_SUCCEEDED');
      } catch (error) {
        emit('BROWSER_HANDOFF_FAILED', safeCommercialPurchaseError(error));
        throw error;
      }
      return { session: currentSession, resumed: true };
    }

    const pending: CommercialPurchaseSession = currentSession ?? {
      requestId: dependencies.createRequestId(),
      clientNonce: dependencies.createClientNonce(),
      previousLicenceId: dependencies.previousLicenceId,
      referenceExpiresAt: new Date(dependencies.now() + 30 * 60_000).toISOString(),
    };

    failureStage = 'PENDING_PURCHASE_SESSION_SAVE_FAILED';
    emit('PENDING_PURCHASE_SESSION_SAVE_STARTED');
    try {
      await dependencies.persistSession(pending);
      emit('PENDING_PURCHASE_SESSION_SAVE_SUCCEEDED');
    } catch (error) {
      emit('PENDING_PURCHASE_SESSION_SAVE_FAILED', safeCommercialPurchaseError(error));
      throw error;
    }

    failureStage = 'LOCAL_COMMERCIAL_PURCHASE_REQUEST_FAILED';
    emit('LOCAL_COMMERCIAL_PURCHASE_REQUEST_STARTED');
    let result: CommercialPurchaseStartedResponse;
    try {
      result = await dependencies.requestPurchase(pending);
      emit('LOCAL_COMMERCIAL_PURCHASE_REQUEST_SUCCEEDED');
    } catch (error) {
      emit('LOCAL_COMMERCIAL_PURCHASE_REQUEST_FAILED', safeCommercialPurchaseError(error));
      throw error;
    }

    const active: CommercialPurchaseSession = {
      ...pending,
      purchaseReference: result.purchaseReference,
      purchaseUrl: result.purchaseUrl,
      referenceExpiresAt: result.referenceExpiresAt,
    };
    failureStage = 'PURCHASE_REFERENCE_PERSIST_FAILED';
    emit('PURCHASE_REFERENCE_PERSIST_STARTED');
    try {
      await dependencies.persistSession(active);
      emit('PURCHASE_REFERENCE_PERSIST_SUCCEEDED');
    } catch (error) {
      emit('PURCHASE_REFERENCE_PERSIST_FAILED', safeCommercialPurchaseError(error));
      throw error;
    }

    failureStage = 'BROWSER_HANDOFF_FAILED';
    emit('BROWSER_HANDOFF_STARTED');
    try {
      if (!(await dependencies.openPurchase(result.purchaseUrl))) throw new Error('BROWSER_HANDOFF_REJECTED');
      emit('BROWSER_HANDOFF_SUCCEEDED');
    } catch (error) {
      emit('BROWSER_HANDOFF_FAILED', safeCommercialPurchaseError(error));
      throw error;
    }
    return { session: active, resumed: false };
  } catch (error) {
    emit('BUY_HANDLER_FAILED', { failureStage, ...safeCommercialPurchaseError(error) });
    throw error;
  }
}
