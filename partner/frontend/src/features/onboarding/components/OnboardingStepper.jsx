// The seven registration steps, shared by /register (steps 1-3, before the email is
// verified) and /onboarding (steps 4-7, driven by the server's onboarding step).
export const STEPS = [
  { id: 'email', label: 'Email' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'code', label: 'Verify' },
  { id: 'FACE', label: 'Face' },
  { id: 'AADHAAR', label: 'Aadhaar' },
  { id: 'PROFILE', label: 'Details' },
  { id: 'COMPLETE', label: 'Done' },
]

export const TITLES = {
  email: ['Register as a technician', 'Start with your email address. We will send you a one-time code.'],
  mobile: ['Your mobile number', 'Customers who book you will reach you on this number after you accept a job.'],
  code: ['Verify your email', 'Enter the 6-digit code we emailed you.'],
  FACE: ['Face verification', 'A quick live photo to confirm it is really you.'],
  AADHAAR: ['Aadhaar details', 'Required to receive jobs. Stored encrypted and shown only masked.'],
  PROFILE: ['Your work details', 'Only what customers need to find the right technician.'],
  COMPLETE: ['Account created', 'Your Partner account is ready.'],
}

export default function OnboardingStepper({ current }) {
  const index = Math.max(0, STEPS.findIndex((step) => step.id === current))
  const finished = current === 'COMPLETE'
  return (
    <div className="mb-6">
      <p className="mb-2 text-xs font-bold text-oc-muted">
        Step {index + 1} of {STEPS.length} · <span className="text-oc-deep">{STEPS[index].label}</span>
      </p>
      <ol className="grid gap-1" style={{ gridTemplateColumns: `repeat(${STEPS.length}, minmax(0, 1fr))` }} aria-label="Registration progress">
        {STEPS.map((step, position) => (
          <li
            key={step.id}
            title={step.label}
            aria-current={position === index ? 'step' : undefined}
            className={`h-1.5 rounded-full ${position < index || finished ? 'bg-oc-green' : position === index ? 'bg-oc-amber' : 'bg-oc-line'}`}
          >
            <span className="sr-only">{step.label}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
