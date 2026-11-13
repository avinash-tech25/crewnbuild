/**
 * Contact & Support (/contact-us).
 *
 * Hero with a search over the help content the application already has, then
 * support topics, the direct contact channels and My Support Tickets on the
 * left, and the guided support form on the right.
 *
 * Every contact detail comes from GET /support/config, which reads operations
 * settings (SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_WHATSAPP, SUPPORT_HOURS,
 * SUPPORT_RESPONSE_TIME). A channel that is not configured is not shown --
 * this page used to print a made-up +965 number and address.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, ChevronDown, Clock, HardHat, Headset, Layers, Loader2, Mail, Phone, RefreshCw, Search, Ticket,
  UserRound, Wallet, Wrench,
} from 'lucide-react'
import { SiteHeader } from '../../public-site/components/landing/SiteHeader.jsx'
import { useLanguage } from '../../public-site/components/landing/useLanguage.js'
import { useLanguage as useApplicationLanguage } from '../../../i18n/LanguageContext.jsx'
import { containerClass } from '../../public-site/components/landing/shared.jsx'
import GuidedSupportForm, { CATEGORY_ICONS } from '../components/GuidedSupportForm.jsx'
import { HELP_FAQ_KEYS } from '../components/SupportModals.jsx'
import { fetchSupportConfig } from '../supportApi.js'
import { chooseIssue, chooseTopic, initialFlow, searchHelp } from '../supportFlow.js'

const heroImageUrl = '/landing/support-hero-agent.jpg'
const focusRing = 'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(18,107,69,.3)]'

// The five topics of the reference design, each opening the matching category.
const TOPICS = [
  { category: 'ACCOUNT', label: 'Account & Registration', icon: UserRound, tone: 'mint' },
  { category: 'PROJECTS', label: 'Builder & Projects', icon: HardHat, tone: 'amber' },
  { category: 'ORDERS', label: 'Supplier & Materials', icon: Layers, tone: 'mint' },
  { category: 'PAYMENTS', label: 'Payments & Subscription', icon: Wallet, tone: 'amber' },
  { category: 'TECHNICAL', label: 'Technical Issues', icon: Wrench, tone: 'mint' },
]

function WhatsAppIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 20.5l1.3-4.1A8.5 8.5 0 1 1 8 19.4l-4.5 1.1z" />
      <path d="M9 8.6c.2-.5.5-.6.8-.6h.5c.2 0 .4.1.5.4l.7 1.6c.1.2 0 .5-.1.7l-.5.6c.6 1.2 1.6 2.2 2.8 2.8l.6-.5c.2-.2.5-.2.7-.1l1.6.7c.3.1.4.3.4.5v.5c0 .3-.1.6-.6.8-.6.3-1.6.4-3-.2a8.6 8.6 0 0 1-4.2-4.2c-.6-1.4-.5-2.4-.2-3z" />
    </svg>
  )
}

function SectionHeading({ id, children, aside }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <h2 id={id} className="flex items-center gap-3 text-[clamp(1.15rem,1rem+.6vw,1.45rem)] font-extrabold tracking-[-.02em] text-oc-ink">
        <span className="h-6 w-1.5 rounded-full bg-oc-amber" aria-hidden="true" />
        {children}
      </h2>
      {aside && <p className="text-[13px] font-medium text-oc-muted">{aside}</p>}
    </div>
  )
}

function ContactCard({ icon, title, value, href, note, external }) {
  return (
    <a
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      className={`group flex min-w-0 items-start gap-3.5 rounded-2xl border border-[rgba(8,62,43,.08)] bg-white p-4 shadow-[0_12px_30px_-24px_rgba(8,62,43,.5)]
                  transition hover:-translate-y-0.5 hover:border-oc-green/40 ${focusRing}`}
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-oc-mint text-oc-green">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-bold text-oc-muted">{title}</span>
        <span className="mt-0.5 block break-words text-[15px] font-extrabold text-oc-ink group-hover:text-oc-green" dir="ltr">{value}</span>
        {note && <span className="mt-1 block text-xs font-medium text-oc-muted">{note}</span>}
      </span>
    </a>
  )
}

function SearchResults({ query, results, onTopic, onRequest }) {
  const [open, setOpen] = useState(null)
  useEffect(() => setOpen(null), [query])
  return (
    <section aria-live="polite" aria-label="Search results" className="rounded-2xl border border-[rgba(8,62,43,.1)] bg-white p-5 shadow-[0_18px_50px_-30px_rgba(8,62,43,.4)]">
      <p className="text-sm font-bold text-oc-ink">
        {results.length ? `${results.length} result${results.length === 1 ? '' : 's'} for “${query}”` : `No results for “${query}”`}
      </p>
      {results.length > 0 && (
        <ul className="mt-3 divide-y divide-oc-line">
          {results.map((result) => (
            <li key={result.id} className="py-2.5">
              {result.kind === 'faq' ? (
                <div>
                  <button
                    type="button"
                    aria-expanded={open === result.id}
                    onClick={() => setOpen(open === result.id ? null : result.id)}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg text-start text-sm font-bold text-oc-ink hover:text-oc-green ${focusRing}`}
                  >
                    <span><span className="me-2 rounded-md bg-oc-mint px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-oc-green">Help</span>{result.title}</span>
                    <ChevronDown size={16} className={`shrink-0 transition-transform ${open === result.id ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </button>
                  {open === result.id && <p className="mt-2 text-[13px] leading-6 text-oc-muted">{result.body}</p>}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onTopic(result)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg text-start text-sm font-bold text-oc-ink hover:text-oc-green ${focusRing}`}
                >
                  <span>
                    <span className="me-2 rounded-md bg-[#fff4d8] px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-[#8a5a00]">Topic</span>
                    {result.title}
                    {result.subtitle && <span className="font-medium text-oc-muted"> · {result.subtitle}</span>}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-extrabold text-oc-green">Get help <ArrowRight size={14} className="rtl:-scale-x-100" aria-hidden="true" /></span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-oc-line pt-3">
        <p className="text-[13px] font-medium text-oc-muted">{results.length ? 'Not what you need?' : 'We could not find an answer for that.'}</p>
        <button type="button" onClick={onRequest} className={`inline-flex items-center gap-1.5 rounded-lg text-[13px] font-extrabold text-oc-green hover:underline ${focusRing}`}>
          Submit a support request <ArrowRight size={14} className="rtl:-scale-x-100" aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}

export default function ContactUsPage() {
  const { text } = useLanguage()
  const { t } = useApplicationLanguage()
  const [config, setConfig] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [flow, setFlow] = useState(null)
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const formRef = useRef(null)

  const load = () => {
    setLoadError(false)
    fetchSupportConfig()
      .then((data) => { setConfig(data); setFlow((current) => current || initialFlow(data)) })
      .catch(() => setLoadError(true))
  }
  useEffect(load, [])

  // The Help Center's own questions and answers, in the reader's language.
  const faqs = useMemo(
    () => HELP_FAQ_KEYS.map((faq) => ({ id: `faq:${faq.id}`, question: t(faq.question), answer: t(faq.answer) })),
    [t],
  )
  const results = useMemo(() => (submittedQuery ? searchHelp(submittedQuery, { faqs, config }) : []), [submittedQuery, faqs, config])

  const showForm = () => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const openTopic = (category, issue) => {
    if (!config) return
    setFlow((current) => {
      let next = chooseTopic(current, config, category)
      if (issue && next.currentStep === 3) next = { ...chooseIssue(next, config, issue), currentStep: 4 }
      return next
    })
    showForm()
  }

  const contact = config?.contact || {}
  const channels = [
    contact.phone && { key: 'phone', icon: <Phone size={21} aria-hidden="true" />, title: 'Call us', value: contact.phone, href: contact.phone_href, note: contact.hours },
    contact.email && { key: 'email', icon: <Mail size={21} aria-hidden="true" />, title: 'Email us', value: contact.email, href: `mailto:${contact.email}`, note: contact.response_time ? `Response time: ${contact.response_time}` : null },
    contact.whatsapp && { key: 'whatsapp', icon: <WhatsAppIcon />, title: 'WhatsApp support', value: contact.whatsapp, href: contact.whatsapp_href, note: contact.hours, external: true },
  ].filter(Boolean)

  const activeTopic = flow?.category || flow?.preferredCategory

  return (
    <div className="min-h-screen overflow-x-clip bg-oc-paper font-display text-oc-ink" id="top">
      <SiteHeader text={text} brandHref="/" />

      <main className="pb-20">
        {/* Hero */}
        <section aria-labelledby="support-hero-title" className="relative mt-[58px] overflow-hidden bg-[linear-gradient(100deg,#062d1f_0%,#083e2b_45%,#0d5238_100%)] text-white max-wide:mt-[52px]">
          {/* The support agent, whole: the photo takes the hero's height and its own
              width (no crop), so the compact card shows the complete picture. The
              panel is as wide as the photo, with the diagonal edge and the amber
              stripe kept on its leading edge. The diagonal's 2.6rem run over the
              196px card matches the stripe's 12deg slant. */}
          {/* Ends at the page content's edge (the same gutter as the text), not the
              screen's, so the photo sits nearer the search bar. */}
          <div aria-hidden="true" className="absolute inset-y-0 end-[max(24px,calc((100%-1240px)/2))] hidden md:block">
            <div className="h-full overflow-hidden [clip-path:polygon(2.6rem_0,100%_0,100%_100%,0_100%)] rtl:[clip-path:polygon(0_0,calc(100%-2.6rem)_0,100%_100%,0_100%)]">
              <img src={heroImageUrl} alt="" className="h-full w-auto max-w-none" />
            </div>
            <div className="absolute inset-y-0 -start-1 w-4 -skew-x-[12deg] bg-oc-amber rtl:skew-x-[12deg]" />
          </div>
          <div aria-hidden="true" className="absolute bottom-0 start-0 h-0 w-0 border-b-[46px] border-e-[46px] border-b-oc-amber border-e-transparent" />

          {/* 196px from tablet up: the full photo takes the card's height, so this
              is what sets her size; the text is centred in it. */}
          <div className={`${containerClass} relative flex flex-col justify-center py-[clamp(.5rem,.35rem+.5vw,.875rem)] md:min-h-[196px]`}>
            <div className="max-w-[640px] md:max-w-[52%]">
              <p className="flex items-center gap-2.5 text-xs font-extrabold uppercase tracking-[.14em] text-white/90 rtl:tracking-normal">
                <Headset size={20} className="text-oc-amber" aria-hidden="true" />
                Support &amp; assistance
                <span className="h-px w-10 bg-oc-amber" aria-hidden="true" />
              </p>
              <h1 id="support-hero-title" className="mt-0.5 text-[clamp(1.35rem,1rem+1.3vw,1.95rem)] font-extrabold leading-[1.08] tracking-[-.03em]">
                How can we <span className="text-oc-amber">help you today?</span>
              </h1>
              <p className="mt-1 max-w-[52ch] text-[clamp(.85rem,.8rem+.2vw,.95rem)] font-medium text-white/85">
                Get quick support, find answers, or reach our team for any assistance.
              </p>

              <form
                role="search"
                className="mt-2.5 flex h-[38px] items-stretch overflow-hidden rounded-xl bg-white shadow-[0_18px_40px_-18px_rgba(0,0,0,.6)] focus-within:ring-4 focus-within:ring-oc-amber/50"
                onSubmit={(event) => { event.preventDefault(); setSubmittedQuery(query.trim()) }}
              >
                <label htmlFor="support-search" className="sr-only">Search help articles, FAQs or support topics</label>
                <Search size={20} className="ms-4 shrink-0 self-center text-oc-muted" aria-hidden="true" />
                <input
                  id="support-search"
                  type="search"
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); if (!event.target.value.trim()) setSubmittedQuery('') }}
                  placeholder="Search help articles, FAQs, or support topics…"
                  className="min-w-0 flex-1 bg-transparent px-3 text-sm font-semibold text-oc-ink outline-none placeholder:font-medium placeholder:text-oc-faint"
                />
                <button type="submit" aria-label="Search" className="m-1 grid w-10 shrink-0 place-items-center rounded-lg bg-oc-amber text-oc-deep transition hover:bg-[#e9a92f] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-oc-deep/30">
                  <Search size={20} aria-hidden="true" />
                </button>
              </form>
            </div>
          </div>
        </section>

        <div className={`${containerClass} mt-6`}>
          {submittedQuery && (
            <div className="mb-8">
              <SearchResults
                query={submittedQuery}
                results={results}
                onTopic={(result) => openTopic(result.category, result.issue)}
                onRequest={showForm}
              />
            </div>
          )}

          {loadError && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">
              Support details could not be loaded. Please check your connection.
              <button type="button" onClick={load} className={`inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-extrabold text-red-700 ring-1 ring-red-200 ${focusRing}`}>
                <RefreshCw size={14} aria-hidden="true" /> Try again
              </button>
            </div>
          )}

          {!config && !loadError && (
            <p className="flex items-center gap-2 py-10 text-sm font-semibold text-oc-muted" role="status">
              <Loader2 size={18} className="animate-spin" aria-hidden="true" /> Loading support options…
            </p>
          )}

          {config && flow && (
            <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(380px,500px)] xl:gap-10">
              <div className="min-w-0 space-y-10">
                <section aria-labelledby="topics-title">
                  <SectionHeading id="topics-title" aside="Get faster and more accurate help.">Choose a support topic</SectionHeading>
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                    {TOPICS.map((topic) => {
                      const Icon = topic.icon || CATEGORY_ICONS[topic.category]
                      const selected = activeTopic === topic.category
                      return (
                        <button
                          key={topic.category}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => openTopic(topic.category)}
                          className={`group flex min-h-[104px] flex-col items-center justify-between gap-1.5 rounded-xl border px-2.5 py-3 text-center transition hover:-translate-y-0.5 ${focusRing}
                                      ${topic.tone === 'amber' ? 'bg-[#fff8e6]' : 'bg-[#eef8f1]'}
                                      ${selected ? 'border-oc-green shadow-[0_12px_28px_-16px_rgba(18,107,69,.7)]' : 'border-transparent hover:border-oc-green/30'}`}
                        >
                          <Icon size={24} strokeWidth={1.8} className={topic.tone === 'amber' ? 'text-[#c98a00]' : 'text-oc-green'} aria-hidden="true" />
                          <span className="text-[13px] font-extrabold leading-snug text-oc-ink">{topic.label}</span>
                          <ArrowRight size={16} className="text-oc-ink transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100" aria-hidden="true" />
                        </button>
                      )
                    })}
                  </div>
                </section>

                <section aria-labelledby="direct-title">
                  <SectionHeading id="direct-title">Contact support directly</SectionHeading>
                  {channels.length ? (
                    <div className="mt-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))]">
                      {channels.map(({ key, ...channel }) => <ContactCard key={key} {...channel} />)}
                    </div>
                  ) : (
                    <p className="mt-4 rounded-2xl border border-oc-line bg-white px-5 py-4 text-sm font-medium text-oc-muted">
                      Use the form to reach our team. Phone and email details have not been published yet.
                    </p>
                  )}
                </section>

                <section aria-labelledby="tickets-title" className="grid gap-4 rounded-2xl border border-[rgba(8,62,43,.08)] bg-white p-5 shadow-[0_12px_30px_-24px_rgba(8,62,43,.5)] md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div className="flex items-start gap-4">
                    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[#fff4d8] text-[#c98a00]">
                      <Ticket size={28} strokeWidth={1.8} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h2 id="tickets-title" className="text-lg font-extrabold text-oc-ink">My Support Tickets</h2>
                      <p className="mt-0.5 text-[13px] font-medium text-oc-muted">Track your requests, check updates and read our replies.</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <Link to="/contact-us/tickets" className={`inline-flex h-11 items-center gap-2 rounded-full border border-oc-green px-5 text-sm font-extrabold text-oc-green hover:bg-oc-mint ${focusRing}`}>
                      View my tickets <ArrowRight size={16} className="rtl:-scale-x-100" aria-hidden="true" />
                    </Link>
                    {contact.response_time && (
                      <div className="flex items-center gap-3 rounded-xl bg-oc-mint/70 px-4 py-2.5">
                        <Clock size={26} className="shrink-0 text-oc-green" aria-hidden="true" />
                        <div>
                          <p className="text-xs font-bold text-oc-muted">Our response time</p>
                          <p className="text-[15px] font-extrabold text-oc-green">{contact.response_time}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              </div>

              <div ref={formRef} className="min-w-0 scroll-mt-[76px]">
                <GuidedSupportForm
                  config={config}
                  flow={flow}
                  setFlow={setFlow}
                  signedIn={Boolean(config.account)}
                  ticketsAvailable={config.tickets_available !== false}
                />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
