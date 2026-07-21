export const SUPPORTED_LICENCE_FEATURES = [
  'collector',
  'dashboard',
  'evidence',
  'guard-safe',
  'reports',
  'csv-export',
  'patrol-ops',
  'alerts',
] as const;

export type LicenceFeatureId = (typeof SUPPORTED_LICENCE_FEATURES)[number];

export interface LicenceFeatureDefinition {
  id: LicenceFeatureId;
  label: string;
  description: string;
  required?: boolean;
}

export const LICENCE_FEATURE_CATALOG: LicenceFeatureDefinition[] = [
  {
    id: 'collector',
    label: 'WhatsApp collector',
    description: 'Required for desktop evidence collection from WhatsApp.',
    required: true,
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    description: 'Operational dashboard and site overview.',
  },
  {
    id: 'evidence',
    label: 'Evidence gallery',
    description: 'Patrol image gallery, timeline and evidence review.',
  },
  {
    id: 'guard-safe',
    label: 'Guard Safe',
    description: 'Guard Safe hourly safety monitoring views.',
  },
  {
    id: 'reports',
    label: 'Reports',
    description: 'Operational and compliance reporting screens.',
  },
  {
    id: 'csv-export',
    label: 'CSV export',
    description: 'Export tables and evidence metadata to CSV.',
  },
  {
    id: 'patrol-ops',
    label: 'Patrol operations',
    description: 'Schedules, slots, groups and site patrol operations.',
  },
  {
    id: 'alerts',
    label: 'Alerts',
    description: 'Missed patrol and operational alert workflows.',
  },
];

export const REQUIRED_LICENCE_FEATURES: LicenceFeatureId[] = ['collector'];

export function defaultFeaturesForPlan(plan: 'TRIAL' | 'MONTHLY' | 'ANNUAL'): LicenceFeatureId[] {
  if (plan === 'TRIAL') {
    return ['collector', 'dashboard', 'evidence'];
  }
  return [...SUPPORTED_LICENCE_FEATURES];
}

export function toggleFeature(current: string[], featureId: string, enabled: boolean): string[] {
  const next = new Set(current);
  if (enabled) {
    next.add(featureId);
  } else if (!(REQUIRED_LICENCE_FEATURES as string[]).includes(featureId)) {
    next.delete(featureId);
  }
  return Array.from(next);
}
