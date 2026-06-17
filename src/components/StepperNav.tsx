interface StepperNavProps {
  currentStep: number
  onSettingsClick: () => void
}

const steps = [
  { label: 'Upload' },
  { label: 'Review' },
  { label: 'Revise' },
  { label: 'Finalize' },
]

const LOGO_SRC = import.meta.env.DEV
  ? '/freedom-electric-logo.svg'
  : '/tools/electrician-estimate/freedom-electric-logo.svg'

export function StepperNav({ currentStep, onSettingsClick }: StepperNavProps) {
  return (
    <nav className="stepper-nav">
      <div className="brand-header">
        <img src={LOGO_SRC} alt="Freedom Electric" className="brand-logo" />
        <div className="brand-name">
          <span className="brand-name-top">Freedom Electric</span>
          <span className="brand-name-bottom">Job Estimator</span>
        </div>
      </div>
      <div className="stepper-steps">
        {steps.map((step, i) => (
          <div
            key={step.label}
            className={`stepper-step ${i === currentStep ? 'active' : ''} ${i < currentStep ? 'done' : ''}`}
          >
            <div className="stepper-dot">{i < currentStep ? '✓' : i + 1}</div>
            <span className="stepper-label">{step.label}</span>
            {i < steps.length - 1 && <div className="stepper-line" />}
          </div>
        ))}
      </div>
      <button className="admin-btn" onClick={onSettingsClick} aria-label="Admin settings" title="Admin — edit prompts, pricing, and API keys">
        ⚙ Admin
      </button>
    </nav>
  )
}
