interface StepperNavProps {
  currentStep: number
}

const steps = [
  { label: 'Upload' },
  { label: 'Review' },
  { label: 'Revise' },
  { label: 'Finalize' },
]

export function StepperNav({ currentStep }: StepperNavProps) {
  return (
    <nav className="stepper-nav">
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
    </nav>
  )
}
