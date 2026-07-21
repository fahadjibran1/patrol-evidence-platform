import type { CustomerStatus, LicensePlan, PaymentStatus } from '../types';
import { defaultFeaturesForPlan } from './licence-features';
import { computeExpiresAtIso } from './plan-dates';
import { todayLondonIsoDate } from './dates';

export const ISSUE_WIZARD_STEPS = [
  'customer',
  'plan',
  'devices',
  'payment',
  'review',
  'success',
] as const;

export type IssueWizardStep = (typeof ISSUE_WIZARD_STEPS)[number];

export const ISSUE_WIZARD_STEP_LABELS: Record<Exclude<IssueWizardStep, 'success'>, string> = {
  customer: 'Customer',
  plan: 'Plan and dates',
  devices: 'Devices and features',
  payment: 'Payment',
  review: 'Review and confirm',
};

export interface IssueWizardDraft {
  customerId: string;
  customerEmail: string;
  customerSnapshot: {
    id: string;
    companyName: string;
    contactName?: string | null;
    email: string;
    status: CustomerStatus;
  } | null;
  plan: LicensePlan;
  startsAt: string;
  expiresAt: string;
  expiryOverridden: boolean;
  maxDevices: number;
  features: string[];
  paymentStatus: PaymentStatus;
  amountPence: number;
  paymentMethod: string;
  paymentReference: string;
  invoiceReference: string;
  notes: string;
  confirmed: boolean;
  step: Exclude<IssueWizardStep, 'success'>;
}

export function createInitialIssueWizardDraft(): IssueWizardDraft {
  const startsAt = todayLondonIsoDate();
  const plan: LicensePlan = 'ANNUAL';
  return {
    customerId: '',
    customerEmail: '',
    customerSnapshot: null,
    plan,
    startsAt,
    expiresAt: computeExpiresAtIso(startsAt, plan),
    expiryOverridden: false,
    maxDevices: 1,
    features: defaultFeaturesForPlan(plan),
    paymentStatus: 'PENDING',
    amountPence: 0,
    paymentMethod: '',
    paymentReference: '',
    invoiceReference: '',
    notes: '',
    confirmed: false,
    step: 'customer',
  };
}

export const ISSUE_WIZARD_STORAGE_KEY = 'patrol-license-portal-issue-wizard-draft';

export function readIssueWizardDraft(): IssueWizardDraft | null {
  try {
    const raw = sessionStorage.getItem(ISSUE_WIZARD_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as IssueWizardDraft;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return {
      ...createInitialIssueWizardDraft(),
      ...parsed,
      confirmed: false,
      step: parsed.step === 'review' ? 'review' : parsed.step === 'payment' ? 'payment' : parsed.step === 'devices' ? 'devices' : parsed.step === 'plan' ? 'plan' : 'customer',
    };
  } catch {
    return null;
  }
}

export function writeIssueWizardDraft(draft: IssueWizardDraft): void {
  const { confirmed: _confirmed, ...persistable } = draft;
  sessionStorage.setItem(ISSUE_WIZARD_STORAGE_KEY, JSON.stringify({ ...persistable, confirmed: false }));
}

export function clearIssueWizardDraft(): void {
  sessionStorage.removeItem(ISSUE_WIZARD_STORAGE_KEY);
}

export function isCustomerSelectable(status: CustomerStatus): boolean {
  return status !== 'CLOSED' && status !== 'SUSPENDED';
}
