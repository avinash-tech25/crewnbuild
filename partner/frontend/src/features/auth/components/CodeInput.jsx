/** A single numeric field for a six-digit email code. */
export default function CodeInput({ value, onChange, disabled = false, autoFocus = true }) {
  return (
    <label className="block">
      <span className="field-label">6-digit code</span>
      <input
        className="field-input text-center font-display text-2xl font-extrabold tracking-[0.5em]"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        required
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
        placeholder="••••••"
      />
    </label>
  )
}
