import type { IssueWizardStep } from '../lib/issue-wizard-state';
import { ISSUE_WIZARD_STEP_LABELS } from '../lib/issue-wizard-state';

const orderedSteps = Object.keys(ISSUE_WIZARD_STEP_LABELS) as Array<keyof typeof ISSUE_WIZARD_STEP_LABELS>;

export function WizardStepper({
  current,
}: {
  current: Exclude<IssueWizardStep, 'success'>;
}): JSX.Element {
  const currentIndex = orderedSteps.indexOf(current);

  return (
    <ol className="wizard-stepper" aria-label="Issue licence steps">
      {orderedSteps.map((step, index) => {
        const state = index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'upcoming';
        return (
          <li key={step} className={`wizard-step wizard-step-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="wizard-step-index">{index + 1}</span>
            <span className="wizard-step-label">{ISSUE_WIZARD_STEP_LABELS[step]}</span>
          </li>
        );
      })}
    </ol>
  );
}
