import { useState } from 'react'
import { CheckCircle2, Clock, Mail, MapPin, Phone, Send } from 'lucide-react'
import { Container, Eyebrow, Reveal } from './ui.jsx'
import { useLanguage } from '../../../../i18n/LanguageContext.jsx'
import { contactErrorKey, submitContactEnquiry } from '../../../support/contactApi.js'

const INFO = [
  { icon: Phone, titleKey: 'site.contact.info.call', lines: ['+91 40 1234 5678', '+91 98 7654 3210'] },
  { icon: Mail, titleKey: 'site.contact.info.email', lines: ['hello@octabuild.in', 'projects@octabuild.in'] },
  {
    icon: MapPin,
    titleKey: 'site.contact.info.visit',
    lines: ['site.contact.info.addr1', 'site.contact.info.addr2'],
  },
  {
    icon: Clock,
    titleKey: 'site.contact.info.hours',
    lines: ['site.contact.info.hours2', 'site.contact.info.appt'],
  },
]

const FIELDS = [
  { name: 'name', labelKey: 'site.contact.f.name', type: 'text', placeholderKey: 'site.contact.f.namePh', span: 1 },
  { name: 'phone', labelKey: 'site.contact.f.phone', type: 'tel', placeholder: '+91 …', span: 1 },
  { name: 'email', labelKey: 'site.contact.f.email', type: 'email', placeholder: 'you@example.com', span: 1 },
  {
    name: 'interest',
    labelKey: 'site.contact.f.interest',
    type: 'select',
    optionKeys: ['site.contact.f.opt1', 'site.contact.f.opt2', 'site.contact.f.opt3', 'site.contact.f.opt4', 'site.contact.f.opt5', 'site.contact.f.opt6'],
    span: 1,
  },
  { name: 'city', labelKey: 'site.contact.f.city', type: 'text', placeholderKey: 'site.contact.f.cityPh', span: 2 },
  { name: 'message', labelKey: 'site.contact.f.message', type: 'textarea', placeholderKey: 'site.contact.f.messagePh', span: 2 },
]

export default function ContactSection() {
  const { t } = useLanguage()
  const [submitted, setSubmitted] = useState(false)
  const [values, setValues] = useState({})
  const [sending, setSending] = useState(false)
  const [errorKey, setErrorKey] = useState('')

  // This used to set `submitted` and nothing else, so the thank-you screen
  // appeared for an enquiry that was never sent anywhere. Success is now the
  // backend's answer: the screen only appears once the enquiry has actually
  // been handed to the mail service.
  const submit = async (e) => {
    e.preventDefault()
    if (sending) return
    setSending(true)
    setErrorKey('')
    try {
      await submitContactEnquiry({
        name: values.name,
        email: values.email,
        phone: values.phone,
        message: values.message,
        interest: values.interest,
        city: values.city,
      })
      setSubmitted(true)
    } catch (error) {
      // `values` is left exactly as it is, so the visitor can correct one field
      // and send again rather than retyping the whole form.
      setErrorKey(contactErrorKey(error))
    } finally {
      setSending(false)
    }
  }

  if (submitted) {
    return (
      <section className="bg-slate-50 py-24 sm:py-28">
        <Container>
          <Reveal>
            <div className="mx-auto max-w-xl rounded-[2rem] border border-brand-200 bg-white p-10 text-center shadow-[0_30px_80px_-45px_rgba(35,102,69,0.5)]">
              <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-brand-50 text-brand-600 ring-1 ring-brand-200">
                <CheckCircle2 className="h-8 w-8" />
              </span>
              <h2 className="h-display mt-6 text-3xl">{t('site.contact.success.title')}</h2>
              <p className="mt-3 text-slate-500">
                {t('site.contact.success.sub', { name: values.name || t('site.contact.success.friend') })}
              </p>
              <button onClick={() => setSubmitted(false)} className="btn-ghost mt-8">
                {t('site.contact.success.again')}
              </button>
            </div>
          </Reveal>
        </Container>
      </section>
    )
  }

  return (
    <section className="bg-slate-50 py-24 sm:py-28">
      <Container>
        <Reveal>
          <Eyebrow>{t('site.contact.eyebrow')}</Eyebrow>
        </Reveal>
        <Reveal delay={0.06}>
          <h2 className="h-display mt-4 max-w-2xl text-[clamp(1.6rem,3.2vw,2.5rem)] leading-[1.12]">
            {t('site.contact.title')} <span className="text-brand-500">{t('site.contact.highlight')}</span>
          </h2>
        </Reveal>
        <Reveal delay={0.12}>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-500 sm:text-lg">
            {t('site.contact.sub')}
          </p>
        </Reveal>

        <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Reveal>
            <form
              onSubmit={submit}
              className="rounded-[2rem] border border-slate-200 bg-white p-7 shadow-[0_30px_80px_-50px_rgba(15,23,42,0.5)] sm:p-9"
            >
              <div className="grid gap-5 sm:grid-cols-2">
                {FIELDS.map((f) => (
                  <label key={f.name} className={`block ${f.span === 2 ? 'sm:col-span-2' : ''}`}>
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      {t(f.labelKey)}
                    </span>
                    {f.type === 'textarea' ? (
                      <textarea
                        required
                        name={f.name}
                        rows={4}
                        placeholder={f.placeholderKey ? t(f.placeholderKey) : f.placeholder}
                        value={values[f.name] || ''}
                        onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                        className="mt-2 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm outline-none transition focus:border-brand-400 focus:bg-white focus:ring-4 focus:ring-brand-500/10"
                      />
                    ) : f.type === 'select' ? (
                      <select
                        name={f.name}
                        value={values[f.name] || ''}
                        onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                        className="mt-2 w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm outline-none transition focus:border-brand-400 focus:bg-white focus:ring-4 focus:ring-brand-500/10"
                      >
                        <option value="">{t('site.contact.f.select')}</option>
                        {f.optionKeys.map((key) => (
                          <option key={key} value={t(key)}>
                            {t(key)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        required
                        name={f.name}
                        type={f.type}
                        placeholder={f.placeholderKey ? t(f.placeholderKey) : f.placeholder}
                        value={values[f.name] || ''}
                        onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm outline-none transition focus:border-brand-400 focus:bg-white focus:ring-4 focus:ring-brand-500/10"
                      />
                    )}
                  </label>
                ))}
              </div>
              {errorKey && (
                <p role="alert" className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                  {t(errorKey)}
                </p>
              )}
              <button
                type="submit"
                disabled={sending}
                className="group mt-7 inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand-500 px-8 py-4 text-[15px] font-bold text-brand-950 shadow-orange transition hover:-translate-y-0.5 hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 sm:w-auto"
              >
                {sending ? t('site.contact.sending') : t('site.contact.submit')}
                <Send className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>
              <p className="mt-4 text-xs text-slate-400">
                {t('site.contact.agree')}
              </p>
            </form>
          </Reveal>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            {INFO.map((c, i) => (
              <Reveal key={c.titleKey} delay={i * 0.06}>
                <div className="group flex gap-4 rounded-3xl border border-slate-200 bg-white p-5 transition-all duration-300 hover:-translate-y-1 hover:border-brand-300 hover:shadow-[0_25px_60px_-40px_rgba(35,102,69,0.5)]">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100 transition group-hover:bg-brand-500 group-hover:text-white">
                    <c.icon className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="font-display text-sm font-extrabold text-graphite">{t(c.titleKey)}</h3>
                    {c.lines.map((l) => (
                      <p key={l} className="mt-0.5 text-sm text-slate-500">
                        {l.startsWith('site.contact.info.') ? t(l) : l}
                      </p>
                    ))}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </Container>
    </section>
  )
}
