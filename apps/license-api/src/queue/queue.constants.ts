/** Logical queue names. Used both as BullMQ queue names (Redis mode) and inline-mode keys. */
export const QUEUE_NAMES = {
  EMAIL: 'email',
  NOTIFICATIONS: 'notifications',
  MAINTENANCE: 'maintenance',
  REPORTS: 'reports',
  STRIPE_WEBHOOKS: 'stripe-webhooks',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Email retry policy: up to 5 attempts total, backing off 30s / 2m / 10m / 1h between tries. */
export const EMAIL_RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 3_600_000];
export const EMAIL_MAX_ATTEMPTS = 5;
