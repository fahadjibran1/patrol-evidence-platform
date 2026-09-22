import { createHash } from 'crypto';
import { PURCHASE_REFERENCE_SCOPE } from './commercial.constants';

export function taggedCommercialHash(tag: string, value: string): string {
  return createHash('sha256').update(`${tag}\0${value}`, 'utf8').digest('hex');
}

export function hashPurchaseReference(reference: string): string {
  return taggedCommercialHash(PURCHASE_REFERENCE_SCOPE, reference);
}
