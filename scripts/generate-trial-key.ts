import { createHash } from 'crypto';

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'company';
}

function sign(parts: string[], secret: string): string {
  return createHash('sha256')
    .update([...parts, secret].join('|'))
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
}

const companyName = process.argv[2] ?? 'Tech Guards Security';
const startDate = (process.argv[3] ?? new Date().toISOString().slice(0, 10)).replace(/-/g, '');
const trialDays = Number(process.argv[4] ?? process.env.TRIAL_DAYS ?? 30);
const secret = process.env.LICENSE_SIGNING_SECRET?.trim() || 'patrol-evidence-platform-license-secret';
const companySlug = slugify(companyName);
const normalizedDate = `${startDate.slice(0, 4)}-${startDate.slice(4, 6)}-${startDate.slice(6, 8)}`;
const signature = sign(['TRIAL', companySlug, normalizedDate, String(trialDays)], secret);

console.log(`TG-TRIAL-${companySlug}-${startDate}-${trialDays}-${signature}`);
