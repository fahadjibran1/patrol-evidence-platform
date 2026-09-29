import { HttpException } from '@nestjs/common';

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

export interface SafeCommercialError {
  errorClass: 'HTTP_EXCEPTION' | 'TYPE_ERROR' | 'ABORT_ERROR' | 'ERROR' | 'UNKNOWN_ERROR';
  errorCode: string;
}

export function safeCommercialError(error: unknown): SafeCommercialError {
  if (error instanceof HttpException) {
    return { errorClass: 'HTTP_EXCEPTION', errorCode: `HTTP_${error.getStatus()}` };
  }
  if (error instanceof TypeError) return { errorClass: 'TYPE_ERROR', errorCode: safeNodeCode(error) };
  if (error instanceof Error && error.name === 'AbortError') {
    return { errorClass: 'ABORT_ERROR', errorCode: 'ABORT_ERR' };
  }
  if (error instanceof Error) return { errorClass: 'ERROR', errorCode: safeNodeCode(error) };
  return { errorClass: 'UNKNOWN_ERROR', errorCode: 'UNCLASSIFIED' };
}

function safeNodeCode(error: Error): string {
  const raw = (error as Error & { code?: unknown }).code;
  return typeof raw === 'string' && SAFE_NODE_CODES.has(raw) ? raw : 'UNCLASSIFIED';
}

export function formatCommercialDiagnostic(
  stage: string,
  fields: {
    status?: number;
    durationMs?: number;
    attempt?: number;
    maxAttempts?: number;
    nextAttempt?: number;
    delayMs?: number;
    errorClass?: string;
    errorCode?: string;
  } = {},
): string {
  const suffix = [
    Number.isInteger(fields.status) ? `status=${fields.status}` : null,
    Number.isFinite(fields.durationMs) ? `durationMs=${Math.max(0, Math.round(fields.durationMs!))}` : null,
    Number.isInteger(fields.attempt) ? `attempt=${fields.attempt}` : null,
    Number.isInteger(fields.maxAttempts) ? `maxAttempts=${fields.maxAttempts}` : null,
    Number.isInteger(fields.nextAttempt) ? `nextAttempt=${fields.nextAttempt}` : null,
    Number.isFinite(fields.delayMs) ? `delayMs=${Math.max(0, Math.round(fields.delayMs!))}` : null,
    fields.errorClass ? `errorClass=${fields.errorClass}` : null,
    fields.errorCode ? `errorCode=${fields.errorCode}` : null,
  ].filter(Boolean).join(' ');
  return `COMMERCIAL_PURCHASE_DIAGNOSTIC stage=${stage}${suffix ? ` ${suffix}` : ''}`;
}
