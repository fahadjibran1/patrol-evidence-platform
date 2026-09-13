const customerSafeFragments = [
  'already exists',
  'does not match',
  'must be',
  'is required',
  'not found',
  'not available',
  'cannot be archived',
  'cannot be restored',
];

/** Keeps implementation, transport and storage details out of normal customer screens. */
export function customerErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;

  const message = error.message.trim();
  const normalized = message.toLowerCase();

  if (normalized.includes('unauthorized') || normalized.includes('401') || normalized.includes('session expired')) {
    return 'Please sign in again to continue.';
  }

  if (normalized.includes('failed to fetch') || normalized.includes('network') || normalized.includes('econn')) {
    return 'PatrolSafe could not reach its local service. Wait a moment and try again.';
  }

  if (customerSafeFragments.some((fragment) => normalized.includes(fragment)) && !/[{}\[\]<>]|\bat\s+\w+\.\w+/.test(message)) {
    return message;
  }

  return fallback;
}
