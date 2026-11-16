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

import { AlertTriangle, ArrowRight, Building2, CheckCircle2, Clock, Flag, ShieldAlert, Users, UserX } from 'lucide-react'
import { fetchAdminOverview } from '../adminApi.js'
import { mayOpen } from '../adminAccess.js'


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

function AttentionCard({ card, value, needsAction, onNav }) {
  const Icon = needsAction ? AlertTriangle : card.icon
  const clickable = Boolean(card.goto && onNav)
  const Tag = clickable ? 'button' : 'div'

  return (
    <Tag
      {...(clickable ? { type: 'button', onClick: () => onNav(card.goto) } : {})}
      className={`group relative flex items-start gap-3 overflow-hidden rounded-xl border bg-white p-4 text-left shadow-sm transition dark:bg-slate-900 ${
        clickable ? 'hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-oc-deep' : ''
      } ${needsAction ? 'border-amber-300' : 'border-slate-200 dark:border-slate-700'}`}
    >
      {/* Only a queue with work waiting carries the accent bar and colour. */}
      {needsAction && <span className="absolute inset-y-0 left-0 w-1 bg-amber-400" aria-hidden="true" />}
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${
          needsAction ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
        }`}
      >
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-bold text-slate-600 dark:text-slate-300">
          {card.label}
        </span>
        <span
          className={`mt-1 block font-display text-2xl font-bold tabular-nums leading-none ${
            needsAction ? 'text-amber-800' : 'text-graphite dark:text-white'
          }`}
        >
          {value ?? '—'}
        </span>
      </span>
      {clickable && (
        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-600" aria-hidden="true" />
      )}
    </Tag>
  )
}

export function Overview({ identity, Panel, useAsync, onNav }) {
  const { data, error, loading } = useAsync(() => fetchAdminOverview(), [])

  if (error) {
    return <Panel title="Dashboard" subtitle={error} />
  }
  if (loading || !data) {
    return <Panel title="Dashboard" subtitle="Loading…" />
  }

  const attention = data.attention || {}
  // The server counts only what this administrator may see; a card also never links to
  // a section their permissions do not open.
  const visibleCards = ATTENTION.filter((card) => card.key in attention && mayOpen(identity, card.goto))
  const sumOf = (key) => (data.countries || []).reduce((sum, country) => sum + (country[key] || 0), 0)
  const totals = data.countries?.length
    ? [
        { key: 'total_accounts', label: 'Total accounts', icon: Users, value: sumOf('accounts'), goto: mayOpen(identity, 'users') ? 'users' : null },
        { key: 'total_projects', label: 'Projects', icon: Building2, value: sumOf('projects'), goto: mayOpen(identity, 'projects') ? 'projects' : null },
      ]
    : []
  const outstanding = visibleCards
    .filter((card) => !card.neutral)
    .reduce((sum, card) => sum + (attention[card.key] || 0), 0)

  return (
    <div className="grid gap-5">
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-graphite dark:text-white">
              {outstanding === 0 ? 'Nothing needs your attention' : 'Needs your attention'}
            </h2>
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
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          {visibleCards.map((card) => (
            <AttentionCard
              key={card.key}
              card={card}
              value={attention[card.key]}
              needsAction={(attention[card.key] || 0) > 0 && !card.neutral}
              onNav={onNav}
            />
          ))}
          {/* The platform's size: never coloured, since a total is not a queue. */}
          {totals.map((card) => (
            <AttentionCard key={card.key} card={card} value={card.value} needsAction={false} onNav={card.goto ? onNav : null} />
          ))}
        </div>
      </section>

    </div>
  )
}
