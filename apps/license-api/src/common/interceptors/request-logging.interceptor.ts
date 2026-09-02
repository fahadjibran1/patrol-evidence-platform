import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from '@/metrics/metrics.service';

/** Field names that must never appear in structured request logs. */
const REDACT_KEY_PATTERN = /password|token|secret|tg1|fulllicense|smtp|authorization|jwt/i;
const REDACTED_VALUE = '[redacted]';

interface MinimalRequest {
  method: string;
  url: string;
  originalUrl?: string;
  ip?: string;
  headers?: Record<string, unknown>;
  route?: { path?: string };
  socket?: { remoteAddress?: string };
  admin?: { sub?: string; role?: string };
  customer?: { sub?: string; customerId?: string; companyId?: string };
  requestId?: string;
  correlationId?: string;
}

interface MinimalResponse {
  statusCode?: number;
}

export interface RequestLogEntry {
  requestId: string;
  correlationId: string;
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  userId: string | null;
  organisationId: string | null;
  companyId: string | null;
  role: string | null;
  ip: string | null;
  userAgent: string | null;
}

/** Deep-redacts any key matching {@link REDACT_KEY_PATTERN}, recursing into objects/arrays. */
export function redactSensitiveFields<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveFields(item)) as unknown as T;
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      result[key] = REDACT_KEY_PATTERN.test(key) ? REDACTED_VALUE : redactSensitiveFields(entryValue);
    }
    return result as unknown as T;
  }
  return value;
}

/**
 * Attaches a request/correlation id to every request, logs a single structured JSON line
 * per request on completion (success or error), and feeds request-count/latency metrics.
 * Never logs raw bodies — only a fixed, pre-approved set of fields — and deep-redacts any
 * field name that looks sensitive as a defence in depth measure.
 */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(@Optional() private readonly metricsService?: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<MinimalRequest>();
    const response = httpContext.getResponse<MinimalResponse>();

    const headerCorrelationId = request.headers?.['x-correlation-id'];
    const correlationId =
      (Array.isArray(headerCorrelationId) ? headerCorrelationId[0] : headerCorrelationId) || randomUUID();
    const requestId = randomUUID();
    request.requestId = requestId;
    request.correlationId = correlationId;

    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.logRequest(request, response, startedAt, correlationId, requestId),
        error: (error: { status?: number }) =>
          this.logRequest(request, response, startedAt, correlationId, requestId, error),
      }),
    );
  }

  private logRequest(
    request: MinimalRequest,
    response: MinimalResponse,
    startedAt: number,
    correlationId: string,
    requestId: string,
    error?: { status?: number },
  ): void {
    const durationMs = Date.now() - startedAt;
    this.metricsService?.increment('requests');
    this.metricsService?.recordRequestLatency(durationMs);

    const statusCode = error?.status ?? response.statusCode ?? (error ? 500 : 200);
    const userAgentHeader = request.headers?.['user-agent'];

    const organisationId = request.customer?.companyId ?? request.customer?.customerId ?? null;
    const entry: RequestLogEntry = {
      requestId,
      correlationId,
      method: request.method,
      route: request.route?.path ?? request.originalUrl ?? request.url,
      statusCode,
      durationMs,
      userId: request.admin?.sub ?? request.customer?.sub ?? null,
      organisationId,
      companyId: organisationId,
      role: request.admin?.role ?? (request.customer ? 'CUSTOMER' : null),
      ip: request.ip ?? request.socket?.remoteAddress ?? null,
      userAgent: (Array.isArray(userAgentHeader) ? userAgentHeader[0] : (userAgentHeader as string)) ?? null,
    };

    this.logger.log(JSON.stringify(redactSensitiveFields(entry)));
  }
}
