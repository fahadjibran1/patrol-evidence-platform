import type { IssueWizardStep } from '../lib/issue-wizard-state';
import { ISSUE_WIZARD_STEP_LABELS } from '../lib/issue-wizard-state';

const issueOrderedSteps = Object.keys(ISSUE_WIZARD_STEP_LABELS) as Array<keyof typeof ISSUE_WIZARD_STEP_LABELS>;

/**
 * Generic step indicator. Defaults to the issue-licence wizard steps for backward
 * compatibility; pass `steps`/`labels`/`ariaLabel` to reuse it for other wizards
 * (e.g. the renewal wizard).
 */
export function WizardStepper<T extends string = Exclude<IssueWizardStep, 'success'>>({
  current,
  steps,
  labels,
  ariaLabel = 'Issue licence steps',
}: {
  current: T;
  steps?: readonly T[];
  labels?: Record<T, string>;
  ariaLabel?: string;
}): JSX.Element {
  const effectiveSteps = steps ?? (issueOrderedSteps as unknown as readonly T[]);
  const effectiveLabels = labels ?? (ISSUE_WIZARD_STEP_LABELS as unknown as Record<T, string>);
  const currentIndex = effectiveSteps.indexOf(current);

  return (
    <ol
      className="wizard-stepper"
      aria-label={ariaLabel}
      style={{ gridTemplateColumns: `repeat(${effectiveSteps.length}, minmax(0, 1fr))` }}
    >
      {effectiveSteps.map((step, index) => {
        const state = index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'upcoming';
        return (
          <li key={step} className={`wizard-step wizard-step-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="wizard-step-index">{index + 1}</span>
            <span className="wizard-step-label">{effectiveLabels[step]}</span>
          </li>
        );
      })}
    </ol>
  );
}
