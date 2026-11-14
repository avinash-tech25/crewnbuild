/**
 * A field's validation message, directly beneath the input it belongs to.
 *
 * The styling is the one the Complete Profile screen already uses for exactly
 * this, so a refused save reads the same wherever it happens. Renders nothing
 * when there is no message, and never renders anything but a string — an error
 * object reaching JSX is what turned a failed save into a blank page.
 */
export default function FieldError({ message }) {
  if (typeof message !== 'string' || !message.trim()) return null
  return <p className="mt-1 text-[11px] font-bold text-red-600">{message}</p>
}
