/**
 * The first screen of the admin console.
 *
 * Ordered on one principle: an operations console is opened to answer "what do I
 * have to do today", not "how big is the platform". So the queue comes first, the
 * counts come second, and both are only shown to an administrator who could act
 * on them.
 *
 * The attention cards are buttons. A number telling you eleven accounts are
 * waiting is only half useful if reaching them takes three more clicks.
 */

import { AlertTriangle, ArrowRight, CheckCircle2, Clock, Flag, ShieldAlert, UserX } from 'lucide-react'
import { fetchAdminOverview } from '../adminApi.js'
import { CountryFlag } from './AdminCountry.jsx'
import { mayOpen } from '../adminAccess.js'

const SCOPE_LABELS = { GLOBAL: 'Global', IN: 'India' }

// Each card keeps its name whatever the number is. The name is what the card is;
// swapping it for a status message means somebody scanning for "Open reports"
// has nothing to scan for — the number carries the state instead.
//
// Every destination carries the same filter the card counted. Landing on an
// unfiltered list after clicking a number is how a count and a screen come to
// disagree in front of the person who trusted the count.
const ATTENTION = [
  {
    key: 'pending_verifications',
    label: 'Awaiting verification',
    icon: ShieldAlert,
    goto: 'verification',
  },
  {
    key: 'open_reports',
    label: 'Open reports',
    icon: Flag,
    goto: 'reports?status=OPEN',
  },
  {
    key: 'stalled_requests',
    label: 'Unanswered requests',
    icon: Clock,
    goto: 'leads?status=pending',
  },
  {
    key: 'suspended_accounts',
    label: 'Suspended accounts',
    icon: UserX,
    goto: 'users?status=SUSPENDED',
    // A state to be aware of rather than a queue to work through, so this one
    // never turns amber.
    neutral: true,
  },
]

function AttentionCard({ card, value, split, needsAction, onNav }) {
  const Icon = needsAction ? AlertTriangle : card.icon

  return (
    <button
      type="button"
      onClick={() => onNav(card.goto)}
      className={`group flex items-center gap-3 rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 ${
        needsAction
          ? 'border-amber-200 bg-amber-50/70 hover:border-amber-300'
          : 'border-slate-200 bg-white hover:border-slate-300'
      } shadow-[0_16px_50px_-40px_rgba(15,23,42,0.55)]`}
    >
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
          needsAction ? 'bg-amber-100 text-amber-700' : 'bg-brand-50 text-brand-600'
        }`}
      >
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block font-display text-2xl font-bold tabular-nums leading-none ${
            needsAction ? 'text-amber-800' : value > 0 ? 'text-graphite' : 'text-slate-300'
          }`}
        >
          {value ?? '—'}
        </span>
        <span className="mt-1 block truncate text-xs font-semibold text-slate-500">
          {card.label}
        </span>
        {/* A Global Super Admin's total says whether anything is wrong but not
            where. Five pending is a different morning depending on whether they
            are all India's, so the split sits under every total. */}
        {split && (
          <span className="mt-1.5 flex items-center gap-2 text-[11px] font-bold tabular-nums">
            <span
              className={`flex items-center gap-1 ${split.IN > 0 ? 'text-graphite' : 'text-slate-300'}`}
            >
              <CountryFlag country="India" className="h-2.5 w-4" />
              India {split.IN}
            </span>
          </span>
        )}
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
    </button>
  )
}

function CountryCard({ country, onNav, canOpenAccounts }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_16px_50px_-40px_rgba(15,23,42,0.55)]">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-display text-[15px] font-bold text-graphite">
          <CountryFlag country={country.country} className="h-4 w-6" />
          {country.country}
        </h3>
        <span className="rounded-md bg-oc-mint px-2 py-0.5 text-[11px] font-bold uppercase text-oc-deep">
          {country.scope}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3">
        {[
          ['Accounts', country.accounts],
          ['Projects', country.projects],
          ['Open reports', country.open_reports],
          ['Administrators', country.administrators],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-slate-50 px-3 py-2">
            <dt className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-400">
              {label}
            </dt>
            <dd className="mt-0.5 font-display text-lg font-bold tabular-nums text-graphite">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {canOpenAccounts && (
      <button
        type="button"
        onClick={() => onNav(`users?country=${encodeURIComponent(country.country)}`)}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-extrabold text-brand-700 hover:text-brand-800"
      >
        <CountryFlag country={country.country} className="h-2.5 w-4" />
        Open {country.country} accounts →
      </button>
      )}
    </div>
  )
}

export function Overview({ identity, Panel, useAsync, onNav }) {
  const { data, error, loading } = useAsync(() => fetchAdminOverview(), [])

  const territory = identity.is_global
    ? 'the whole platform'
    : `${SCOPE_LABELS[identity.scope] || identity.scope} only`

  if (error) {
    return <Panel title="Dashboard" subtitle={error} />
  }
  if (loading || !data) {
    return <Panel title="Dashboard" subtitle="Loading…" />
  }

  const attention = data.attention || {}
  const byCountry = data.attention_by_country
  // The server counts only what this administrator may see; a card also never links to
  // a section their permissions do not open.
  const visibleCards = ATTENTION.filter((card) => card.key in attention && mayOpen(identity, card.goto))
  const outstanding = visibleCards
    .filter((card) => !card.neutral)
    .reduce((sum, card) => sum + (attention[card.key] || 0), 0)

  return (
    <div className="grid gap-5">
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-xl font-bold text-graphite">
              {outstanding === 0 ? 'Nothing needs you right now' : 'Needs your attention'}
            </h1>
            <p className="mt-0.5 text-sm font-medium text-slate-600">
              You are administering {territory}.
            </p>
          </div>
          {outstanding === 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ocbrand-50 px-3 py-1 text-xs font-extrabold text-ocbrand-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> All queues clear
            </span>
          )}
        </div>

        {/* Every card is always shown. A queue that is empty today will not be
            tomorrow, and a card that disappears when it is clear is a card whose
            position nobody can learn. */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {visibleCards.map((card) => (
            <AttentionCard
              key={card.key}
              card={card}
              value={attention[card.key]}
              split={
                byCountry && {
                  IN: byCountry.IN?.[card.key] ?? 0,
                }
              }
              needsAction={(attention[card.key] || 0) > 0 && !card.neutral}
              onNav={onNav}
            />
          ))}
        </div>
      </section>

      {data.countries?.length > 0 && (
        <section>
          <h2 className="font-display text-[15px] font-bold text-graphite">
            {identity.is_global ? 'By country' : `${data.countries[0].country} at a glance`}
          </h2>
          <p className="mt-0.5 text-xs font-medium text-slate-500">
            {identity.is_global
              ? 'Each location administrator sees just their own.'
              : 'The market you are responsible for.'}
          </p>
          <div
            className={`mt-3 grid gap-3 ${identity.is_global ? 'lg:grid-cols-2' : 'sm:grid-cols-2'}`}
          >
            {data.countries.map((country) => (
              <CountryCard key={country.scope} country={country} onNav={onNav} canOpenAccounts={mayOpen(identity, 'users')} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
