/**
 * Development-only notice under the WhatsApp code boxes.
 *
 * Shown only when the API answered in its development preview mode
 * (WHATSAPP_DEV_OTP_PREVIEW on a development server): no WhatsApp message was
 * sent, and -- for a request from the developer's own machine -- the API
 * returned the code so it can be typed in. Never shown otherwise.
 */
export function DevOtpNotice({ code }) {
  return (
    <p role="note" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-900">
      Development mode — WhatsApp not sent.
      {code ? (
        <>
          {' '}Your code: <span className="font-mono text-sm font-extrabold tracking-widest" data-testid="dev-otp">{code}</span>
        </>
      ) : ' The code is only shown on the developer’s own machine.'}
    </p>
  )
}
