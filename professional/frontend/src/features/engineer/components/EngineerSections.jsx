import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  Briefcase,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  HardHat,
  Mail,
  MapPin,
  Phone,
  Pencil,
  ShieldCheck,
  Star,
  UserRound,
  X,
} from 'lucide-react'
import DashboardHero from '../../../shared/dashboard/DashboardHero.jsx'
import HeroConstructionScene from '../../../shared/dashboard/HeroConstructionScene.jsx'
import { SmartImage } from '../../../shared/ui/ui.jsx'
import { EntityCard } from '../../../shared/ui/EntityCard.jsx'
import { EntityAvatar, EntityPill } from '../../../shared/ui/EntityPill.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { avatarFromPath, userAvatarSrc } from '../../../shared/ui/avatars.js'
import { buildingTypeText, inr, projectStatusText } from '../../builder/builderHelpers.js'
import { constructionTypeLabel } from '../../../shared/utils/roleLabels.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { translatorFrom } from '../../../i18n/translate.js'
import { formatCalendarDate, formatDateTime } from '../../../shared/utils/formatters.js'
import { completionPercent, completionText, formatPercent, scheduleText, scheduleWidth } from '../../../shared/utils/projectProgress.js'
import { ENGINEER_CATEGORY_LABEL_KEYS, engineerCategoryChoices } from '../../onboarding/profileConstants.js'
import { optionLabel, SERVICE_OPTION_KEYS } from '../../../i18n/optionKeys.js'
import { RequiredMark, requiredProfileFields } from '../../accounts/components/ProfileCompletionMeter.jsx'
import FieldError from '../../../shared/ui/FieldError.jsx'
import PincodeAreaHint from '../../../shared/ui/PincodeAreaHint.jsx'
import { usePincodeAreaLookup } from '../../../shared/hooks/usePincodeAreaLookup.js'
import { INVALID_FIELD_CLASS, useProfileFormErrors } from '../../../shared/hooks/useProfileFormErrors.js'
import ProfileImageHint from '../../../shared/ui/ProfileImageHint.jsx'
import { PROFILE_IMAGE_ACCEPT } from '../../../shared/utils/profileImageRules.js'
import { ratingLabel } from '../../../shared/utils/ratingLabel.js'
import { BuilderTierBadge } from '../../billing/subscription/TierBadge.jsx'

// `t` stays an accepted argument so the existing call sites are unchanged, but
// it no longer decides whether the label is translated: half the call sites pass
// only the status (they want the pill classes), and an English fallback there
// meant the four labels could still reach the screen in English. The active
// language is read directly instead. A status the list does not know now reads
// as Unknown rather than being painted as its raw API code.
export function teamStatusMeta(status, t) {
  const translate = translatorFrom(t)
  if (status === 'ACTIVE') return { label: translate('dash.engineer.team.activeMember'), pill: 'bg-emerald-50 text-emerald-700 ring-emerald-100' }
  if (status === 'PENDING') return { label: translate('dash.engineer.team.requestPending'), pill: 'bg-brand-50 text-brand-700 ring-brand-100' }
  if (status === 'REJECTED') return { label: translate('dash.engineer.team.declined'), pill: 'bg-rose-50 text-rose-600 ring-rose-100' }
  return { label: translate('dash.engineer.team.unknown'), pill: 'bg-slate-100 text-slate-600 ring-slate-200' }
}

/**
 * The two letters an avatar falls back to when there is no picture.
 *
 * Taken from the name, and only from a translated word when there is no name at
 * all -- so the hardcoded 'E', 'P', 'C' and 'B' initials are gone without ever
 * upper-casing a translated string, which is a no-op in Indic scripts and wrong
 * in Arabic.
 */
function avatarInitials(name, fallbackLabel, length = 2) {
  const typed = String(name || '').trim()
  if (typed) return typed.slice(0, length).toUpperCase()
  return String(fallbackLabel || '').trim().slice(0, length)
}

export function SectionHeader({ icon: Icon, title, subtitle, action }) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
      {/* min-w-0 lets the one-line subtitle truncate as intended; without it the
          subtitle's full width pushed the page sideways on a phone. */}
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h1 className="text-base font-extrabold text-slate-950">{title}</h1>
          {subtitle && <p className="mt-0.5 max-w-xl truncate text-xs font-medium text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {action}
    </section>
  )
}

// The same banner the Homeowner, Builder and Supplier dashboards render, so the
// Site Engineer's hero belongs to the same system instead of being a look-alike
// copy with its own colours and spacing. The greeting and the subtitle are the
// existing ones; Book Technician lives in the dashboard's Quick Actions, and
// Live Camera on each project in My Projects.
export function EngineerDashboardHero({ userShell, aside = null }) {
  const { t } = useLanguage()
  return (
    <DashboardHero
      avatar={{
        image: avatarFromPath(userShell.profileImageUrl, 'ENGINEER'),
        name: userShell.initials || avatarInitials('', t('role.engineer'), 1),
      }}
      title={t('dash.engineer.hero.welcome', { name: userShell.name })}
      subtitle={t('dash.engineer.hero.sub')}
      illustration={<HeroConstructionScene className="h-full w-full" />}
      // The House Owner's banner treatment, shared by all four dashboards,
      // with the owner's grey-to-green shading and dark green edge.
      variant="cream"
      tint="mist"
      aside={aside}
    />
  )
}

export function EngineerMyProjectsSection({ projectList, onOpenProject }) {
  const { t, td } = useLanguage()
  return (
    <div className="space-y-3">
      {/* No section header here: the nav item the engineer just clicked already
          reads My Projects, so a white card repeating it directly underneath
          said the same thing twice. The other sections keep their header —
          each of those carries a subtitle or an action this one never had. */}
      {projectList.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-brand-200 bg-white p-8 text-center shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
          <HardHat className="mx-auto mb-2 h-8 w-8 text-brand-400" />
          <h2 className="font-display text-base font-extrabold text-slate-950">{t('dash.engineer.noAssignedProjects')}</h2>
          <p className="mx-auto mt-1 max-w-md text-xs font-medium text-slate-500">
            {t('dash.engineer.noAssignedProjectsSub')}
          </p>
        </section>
      ) : (
        // The compact project cards the Builder and House Owner dashboards use:
        // cover, project, builder company / person and the status in the
        // corner; then pincode, building type and end date pills, progress
        // and amount, the completion bar, the schedule and Open Project. Every value is one the
        // /engineers/my-projects payload already sends; a missing one is
        // simply not drawn.
        <div className="engineer-project-cards grid auto-rows-[minmax(178px,1fr)] grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projectList.map((project) => {
            // Who the engineer answers to, from the fields /engineers/my-projects
            // already sends: the builder's company leads, the project sits under
            // it, and the builder's own name closes the group. A
            // self-construction project has no builder, so the owner who hired
            // the engineer stands in, and only then does the placeholder apply.
            const builderCompany = td(project.company_name || '')
            const builderPerson = td(project.contractor_name || project.owner_name || '')
            const identityTop = builderCompany || builderPerson || t('dash.engineer.yourBuilder')
            const identityBottom = builderPerson && builderPerson !== identityTop ? builderPerson : ''
            const projectTitle = td(project.title)
            // The confirmed contract once there is one, else the owner's budget.
            const amount = project.contract_amount ?? project.awarded_amount ?? project.budget
            // The bar fills to the schedule figure (elapsed planned time), once
            // work has actually started on site; before that it stays empty.
            const started = project.work_started === true
            const elapsed = started ? scheduleWidth(project) : 0
            const schedule = scheduleText(project, t)
            const endDate = formatCalendarDate(project.end_date, '', { month: 'short', year: 'numeric' })
            const buildingType = buildingTypeText(project.building_type, t)
            const status = String(project.status || '').toLowerCase()
            const statusText = status ? projectStatusText(project.status, t) : ''
            const statusLive = status === 'active' || status === 'in_progress' || status === 'accepted'
            const subtitle = identityBottom ? `${identityTop} · ${identityBottom}` : identityTop
            const progressValue = completionPercent(project) !== null
              ? completionText(project, t)
              : !started
                ? t('progress.scheduleNotStarted')
                : ['in_progress', 'end_date_passed'].includes(project.schedule_status) ? formatPercent(elapsed) : ''
            const progressLabel = completionPercent(project) !== null ? t('dash.engineer.complete') : t('dash.contractor.progress')
            return (
              <div key={project.id} className="relative h-full">
                {/* The project status, in the card's top corner beside the title. */}
                {statusText && (
                  <span className={`pointer-events-none absolute end-3 top-3 z-[1] inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold max-wide:end-2.5 max-wide:top-2.5 ${statusLive ? 'bg-emerald-50 text-emerald-700' : 'bg-oc-sunken text-oc-muted'}`}>
                    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${statusLive ? 'bg-emerald-500' : 'bg-oc-faint'}`} />
                    {statusText}
                  </span>
                )}
                <EntityCard
                  compact
                  fill
                  onClick={() => onOpenProject(project)}
                  avatar={
                    <EntityAvatar
                      src={project.cover_image_url ? imageUrl(project.cover_image_url) : ''}
                      alt={projectTitle}
                      fallback={avatarInitials(project.title, t('dash.common.project'), 1)}
                    />
                  }
                  // Room on the right of the name for the status in the corner.
                  title={<span className={`block truncate ${statusText ? 'pe-20' : ''}`}>{projectTitle}</span>}
                  // The builder company and the builder (or the owner who hired
                  // the engineer on a self-construction project).
                  subtitle={subtitle}
                  pills={[
                    { key: 'pincode', text: project.pincode || '—', icon: MapPin, tone: 'positive' },
                    ...(buildingType ? [{ key: 'type', text: buildingType, tone: 'info' }] : []),
                    ...(endDate ? [{ key: 'end', text: endDate, icon: CalendarDays, tone: 'accent' }] : []),
                  ]}
                >
                  {/* Progress on the left, the amount on the right, pinned to the
                      foot of the card. */}
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-2">
                    <span className="text-[11px] font-semibold text-oc-muted">{progressValue ? `${progressLabel}: ${progressValue}` : ''}</span>
                    {amount ? <span className="text-sm font-extrabold text-oc-ink">{inr(amount)}</span> : null}
                  </div>
                  {/* Fills to the schedule figure (elapsed planned time). */}
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${elapsed}%` }} />
                  </div>
                  <div className="mt-1 flex min-h-[15px] items-center gap-2">
                    <p aria-hidden={schedule ? undefined : true} className="min-w-0 flex-1 truncate text-[10px] font-semibold text-oc-muted">{schedule ? `${t('progress.schedule')}: ${schedule}` : ''}</p>
                    <button
                      type="button"
                      onClick={() => onOpenProject(project)}
                      className="inline-flex shrink-0 items-center gap-1 rounded text-[10px] font-extrabold text-oc-green hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oc-green/40"
                    >
                      {t('dash.engineer.openProject')} <ArrowUpRight aria-hidden="true" className="h-3 w-3 rtl:-scale-x-100" />
                    </button>
                  </div>
                </EntityCard>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function EngineerJoinTeamSection({ pendingCode, teams, incomingRequests, onJoin, onRefresh, onRespondToBuilder, joinMessage, joinError }) {
  const { t, td } = useLanguage()
  const [code, setCode] = useState(pendingCode || '')
  const activeTeams = teams.filter((team) => team.status === 'ACTIVE')
  const pendingTeams = teams.filter((team) => team.status !== 'ACTIVE')
  useEffect(() => { if (pendingCode) setCode(pendingCode) }, [pendingCode])
  const handleSubmit = (event) => {
    event.preventDefault()
    onJoin(code)
  }
  return (
    <div className="space-y-3">
      {/* No section header: the tab the engineer just clicked already reads
          Join Builder Team, so the white card under it said the same thing
          twice. Refresh keeps working — it moves onto the invite card below,
          the one this header used to sit on top of. */}

      {/* Invite code input. Only where the page joins by code (onJoin): the
          Store Manager's Builders page joins by request and leaves it out. */}
      {onJoin && <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-xs font-extrabold uppercase tracking-wide text-slate-400">{t('dash.engineer.joinTeam')}</p>
          <button type="button" onClick={onRefresh} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-extrabold text-slate-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800">
            {t('dash.engineer.refresh')}
          </button>
        </div>
        {/* Wraps on a phone: the code box keeps a usable width and Join goes
            under it, instead of the pair running past the screen. */}
        <form onSubmit={handleSubmit} className="flex flex-wrap gap-2">
          <input
            type="text"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder={t('dash.engineer.msg.enterCode')}
            className="min-w-[min(100%,10rem)] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
          <button type="submit" className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-5 text-sm font-extrabold text-white transition hover:bg-brand-700">
            {t('dash.engineer.joinTeam')}
          </button>
        </form>
        {joinMessage && <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-800">{joinMessage}</p>}
        {joinError && <p className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-bold text-rose-700">{joinError}</p>}
      </section>}

      {activeTeams.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
          <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-400">{t('dash.engineer.myTeam')}</p>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {activeTeams.map((team) => (
              <div key={team.relationship_id} className="flex items-center gap-3 px-3.5 py-2.5 transition hover:bg-brand-50/40">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-extrabold text-white">
                  {avatarInitials(team.company_name || team.contractor_name, t('role.builder'))}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold text-slate-950">{td(team.company_name)}</p>
                  <p className="truncate text-xs font-medium text-slate-500">{td(team.contractor_name)} · {t('dash.common.pincode')} {team.pincode || '—'}</p>
                </div>
                {/* No .toUpperCase(): the label is already translated, and
                    upper-casing a translated string does nothing in Indic
                    scripts and is wrong in Arabic. */}
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold ring-1 ${teamStatusMeta(team.status).pill}`}>
                  {teamStatusMeta(team.status, t).label}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Incoming builder requests — contractor sent a request to this engineer */}
      {incomingRequests && incomingRequests.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
          <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-400">{t('dash.engineer.incomingBuilderRequests')}</p>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {incomingRequests.map((request) => (
              <div key={request.relationship_id} className="flex items-center gap-3 px-3.5 py-2.5 transition hover:bg-brand-50/40">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-extrabold text-white">
                  {avatarInitials(request.company_name || request.contractor_name, t('role.builder'))}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold text-slate-950">{td(request.company_name || request.contractor_name)}</p>
                  <p className="truncate text-xs font-medium text-slate-500">{td(request.contractor_name)} · {t('dash.common.pincode')} {request.pincode || '—'}</p>
                </div>
                {onRespondToBuilder && (
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => onRespondToBuilder(request.relationship_id, 'ACCEPT')}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-oc-green px-3 text-xs font-extrabold text-white transition hover:bg-oc-deep"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> {t('ce.accept')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRespondToBuilder(request.relationship_id, 'REJECT')}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-xs font-extrabold text-rose-600 transition hover:border-rose-300 hover:bg-rose-50"
                    >
                      {t('ce.reject')}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {pendingTeams.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
          <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-400">{t('ui.requests')}</p>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {pendingTeams.map((team) => (
              <div key={team.relationship_id} className="flex items-center gap-3 px-3.5 py-2.5 transition hover:bg-brand-50/40">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-200 text-xs font-extrabold text-slate-600">
                  {avatarInitials(team.company_name || team.contractor_name, t('role.builder'))}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold text-slate-950">{td(team.company_name)}</p>
                  <p className="truncate text-xs font-medium text-slate-500">{td(team.contractor_name)} · {t('dash.common.pincode')} {team.pincode || '—'}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold ring-1 ${teamStatusMeta(team.status).pill}`}>
                  {teamStatusMeta(team.status, t).label}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

export function EngineerContractorsSection({ contractors, teamStatusByContractor, onViewContractor, onRequestJoin, message }) {
  const { t, td } = useLanguage()
  return (
    <div className="space-y-3">
      {/* No section header: the Discover Builders tab above already names this
          list, so the white card repeating it was the same title twice. */}
      {message && <p className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-2.5 text-sm font-bold text-brand-800">{message}</p>}
      {contractors.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-brand-200 bg-white p-8 text-center shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
          <Building2 className="mx-auto mb-2 h-8 w-8 text-brand-400" />
          <h2 className="font-display text-base font-extrabold text-slate-950">{t('dash.engineer.noBuilders')}</h2>
          <p className="mx-auto mt-1 max-w-md text-xs font-medium text-slate-500">
            {t('dash.engineer.noBuildersSub')}
          </p>
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {contractors.map((contractor) => {
            const teamState = teamStatusByContractor(contractor.user_id)
            return (
              <EntityCard
                key={contractor.user_id}
                compact
                icon={Building2}
                label={t('role.contractor')}
                onClick={() => onViewContractor(contractor)}
                avatar={
                  /* The company mark leads on a company card, as it always
                      has; without one this falls through to the builder's own
                      avatar instead of a generic icon. */
                  <EntityAvatar
                    src={contractor.company_logo_url ? imageUrl(contractor.company_logo_url) : userAvatarSrc(contractor, 'BUILDER')}
                    alt={td(contractor.company_name)}
                  />
                }
                title={<span className="inline-flex max-w-full items-center gap-1.5"><span className="truncate">{td(contractor.company_name)}</span><BuilderTierBadge builderId={contractor.user_id} /></span>}
                subtitle={`${contractor.completed_projects || 0} ${t('dash.supplier.projects')}`}
                pills={[
                  { key: 'pincode', text: `${t('dash.common.pincode')} ${contractor.pincode || '—'}`, icon: MapPin },
                  { key: 'experience', text: `${contractor.experience_years || 0} ${t('dash.supplier.yrs')}` },
                  { key: 'rating', text: String(contractor.rating || t('dash.common.new')), tone: 'brand', icon: Star },
                ]}
              >
                {teamState === 'active' ? (
                  <div className="mt-3">
                    <EntityPill tone="positive" icon={CheckCircle2}>{t('dash.engineer.inYourTeam')}</EntityPill>
                  </div>
                ) : teamState === 'pending' ? (
                  <div className="mt-3">
                    <EntityPill tone="accent" dot icon={Clock}>{t('dash.engineer.requestSent')}</EntityPill>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onRequestJoin(contractor)}
                    className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-oc-green px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-oc-deep"
                  >
                    <UserRound className="h-3.5 w-3.5" /> {t('dash.engineer.requestToJoin')}
                  </button>
                )}
              </EntityCard>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function EngineerOpportunitiesSection({ opportunities, appliedKeys, onApply, onView, message }) {
  const { t, td } = useLanguage()
  return (
    <div className="space-y-4">
      {/* No section header: the Find Opportunities tab above already names this
          list, so the white card repeating it was the same title twice. */}
      {message && <p className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-2.5 text-sm font-bold text-brand-800">{message}</p>}
      {opportunities.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-brand-200 bg-white p-10 text-center shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
          <Briefcase className="mx-auto mb-3 h-9 w-9 text-brand-400" />
          <h2 className="font-display text-lg font-extrabold text-slate-950">{t('dash.engineer.noOpportunities')}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm font-medium text-slate-500">
            {t('dash.engineer.noOpportunitiesSub')}
          </p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
          <div className="divide-y divide-slate-100">
            {opportunities.map((opportunity) => {
              const applied = appliedKeys.includes(String(opportunity.project_id))
              return (
                <div key={opportunity.project_id} className="flex flex-wrap items-center gap-3 px-4 py-3 transition hover:bg-brand-50/40">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold text-slate-950">{td(opportunity.title)}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs font-medium text-slate-500">
                      <span className="flex items-center gap-1">
                        <Building2 className="h-3 w-3 shrink-0 text-brand-700" /> {td(opportunity.company_name)}
                      </span>
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3 shrink-0 text-brand-700" /> {td(opportunity.address)} · {opportunity.pincode}
                      </span>
                      {opportunity.construction_type && <span>{constructionTypeLabel(opportunity.construction_type)}</span>}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-extrabold text-slate-700">{inr(opportunity.budget)}</span>
                  <button
                    type="button"
                    onClick={() => onView(opportunity)}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
                  >
                    {t('dash.engineer.viewOpportunity')}
                  </button>
                  {applied ? (
                    <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-emerald-50 px-3 text-xs font-extrabold text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" /> {t('dash.engineer.applied')}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onApply(opportunity)}
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-xs font-extrabold text-white transition hover:bg-brand-700"
                    >
                      {t('dash.engineer.apply')} <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

export function EngineerNotificationsSection({ notifications, onMarkAllRead }) {
  const { t, td } = useLanguage()
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Bell}
        title={t('dash.engineer.notifications')}
        subtitle={t('dash.engineer.notificationsSub')}
        action={
          <button type="button" onClick={onMarkAllRead} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-extrabold text-slate-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800">
            {t('dash.engineer.markAllRead')}
          </button>
        }
      />
      <section className="rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
        {notifications.length === 0 ? (
          <p className="p-8 text-center text-sm font-semibold text-slate-400">{t('dash.engineer.noNotifications')}</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {notifications.map((notification) => (
              <div key={notification.id} className={`flex items-start gap-3 px-3.5 py-3.5 ${notification.is_read ? 'opacity-70' : ''}`}>
                <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${notification.is_read ? 'bg-slate-100 text-slate-400' : 'bg-brand-50 text-brand-700'}`}>
                  <Bell className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-extrabold text-slate-950">{td(notification.title)}</p>
                  <p className="mt-0.5 text-xs font-medium leading-relaxed text-slate-500">{td(notification.body)}</p>
                </div>
                <span className="shrink-0 text-[10px] font-bold text-slate-400">{formatDateTime(notification.created_at, notification.created_at || '')}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

// The order the fields are read on screen, so "the first invalid one" means the
// first the engineer would reach rather than the first the backend happened to
// serialise. Fields the backend can name but this form does not show are simply
// absent; the general message carries those.
const ENGINEER_FIELD_ORDER = [
  'name', 'phone', 'address', 'pincode',
  'experience_years', 'qualification', 'specialization', 'license_number', 'about',
]

/**
 * One read-only field: the label, and its value immediately beside it.
 *
 * A fixed label column rather than `justify-between`, which pushed the value to
 * the opposite edge of the card and left a stretch of white space between the
 * two halves of the same fact.
 */
function EngineerDetailRow({ label, value, required = false }) {
  return (
    <div className="grid grid-cols-1 gap-x-3 border-b border-slate-100 py-1.5 last:border-0 sm:grid-cols-[minmax(0,132px)_minmax(0,1fr)] sm:items-baseline">
      <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400">{label}{required && <RequiredMark satisfied={value !== null && value !== undefined && value !== ''} />}</span>
      <span className="min-w-0 break-words text-sm font-bold text-slate-900">{value || '—'}</span>
    </div>
  )
}

export function EngineerProfileSection({ profile, user, onSave, onProfileImageUpload, uploadMessage, saveMessage, errorMessage }) {
  const { t, td } = useLanguage()
  // Which labels carry the mandatory mark comes from the API's own
  // profile_completion definition, never from a list kept here.
  const requiredFields = requiredProfileFields(user)
  const buildForm = () => ({
    name: user?.name || '',
    phone: user?.phone || '',
    address: user?.address || '',
    pincode: user?.pincode || '',
    experience_years: profile?.experience_years ?? 0,
    qualification: profile?.qualification || '',
    specialization: profile?.specialization || '',
    license_number: profile?.license_number || '',
    about: profile?.about || '',
  })
  // The profile reads as plain information until the engineer asks to change
  // it. One flag for the section, so there is exactly one Save for all of it.
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(buildForm)
  const [saving, setSaving] = useState(false)
  const { fieldErrors, formError, registerField, clearErrors, clearFieldError, applyError } = useProfileFormErrors()
  // The dashboard refreshes on a timer. Re-seeding the form from the refreshed
  // account would throw away whatever the person has typed since, so the
  // incoming values are ignored while the editor is open or there are unsaved
  // edits, until the next save or an explicit Cancel.
  const hasUnsavedEdits = useRef(false)
  const editingRef = useRef(editing)
  editingRef.current = editing

  useEffect(() => {
    if (editingRef.current || hasUnsavedEdits.current) return
    setForm(buildForm())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    user?.name,
    user?.phone,
    user?.address,
    user?.pincode,
    profile?.experience_years,
    profile?.qualification,
    profile?.specialization,
    profile?.license_number,
    profile?.about,
  ])

  const update = (field, value) => {
    hasUnsavedEdits.current = true
    setForm((current) => ({ ...current, [field]: value }))
    clearFieldError(field)
  }

  // The pincode resolves the area. It only ever fills a field that is empty, so
  // an address the engineer typed themselves is never overwritten.
  const applyResolvedArea = useCallback((areaDetails) => {
    setForm((current) => (
      current.address ? current : { ...current, address: areaDetails.display || current.address }
    ))
  }, [])
  const pincodeLookupState = usePincodeAreaLookup(editing ? form.pincode : '', applyResolvedArea, user?.country_of_residence)

  const startEditing = () => {
    clearErrors()
    setForm(buildForm())
    hasUnsavedEdits.current = false
    setEditing(true)
  }

  const submitProfile = async (event) => {
    event?.preventDefault()
    if (saving) return
    setSaving(true)
    clearErrors()
    try {
      await onSave(form)
      hasUnsavedEdits.current = false
      setEditing(false)
    } catch (error) {
      // The editor stays open with everything the engineer entered still in it;
      // the backend decides which field is wrong and this points them at it.
      applyError(error, t('dash.engineer.msg.unableSaveProfile'), ENGINEER_FIELD_ORDER)
    } finally {
      setSaving(false)
    }
  }

  const cancelEdits = () => {
    hasUnsavedEdits.current = false
    setForm(buildForm())
    clearErrors()
    setEditing(false)
  }

  const inputClass = 'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100'
  // A muted twin of inputClass. The conflicting utilities are swapped out
  // rather than appended, so no element carries two of the same kind.
  const readOnlyInputClass = inputClass.replace('bg-white', 'bg-slate-50').replace('text-slate-800', 'text-slate-500') + ' cursor-not-allowed'
  // The invalid treatment replaces the resting border and background for the
  // same reason: two of either would leave which one wins to declaration order.
  const fieldClass = (field) => (
    fieldErrors[field]
      ? `${inputClass.replace('border-slate-200 ', '').replace('bg-white ', '')} ${INVALID_FIELD_CLASS}`
      : inputClass
  )
  const savedCategory = String(form.specialization || '').trim()
  const categoryChoices = engineerCategoryChoices(profile?.specialization, savedCategory)

  return (
    <div className="space-y-3">
      {/* One card, not three. The separate "Profile / Settings" header card and
          the summary tiles above it both restated what this card already shows,
          which is what made the screen tall and empty. */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <UserRound className="h-[18px] w-[18px] shrink-0 text-brand-600" />
            <p className="truncate font-display text-[15px] font-bold text-slate-950">{t('dash.engineer.profileSettingsSub')}</p>
          </div>
          {!editing && (
            <button
              type="button"
              onClick={startEditing}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 text-xs font-extrabold text-white transition hover:-translate-y-0.5 hover:bg-brand-700"
            >
              <Pencil className="h-3.5 w-3.5" /> {t('dash.common.edit')}
            </button>
          )}
        </div>

        {/* The photo sits at the top of the profile, above the fields it belongs
            to, rather than in a tall column beside them. */}
        <div className="mb-3 flex flex-col items-center gap-2 border-b border-slate-100 pb-3">
          <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400">{t('dash.engineer.profilePhoto')}</p>
          <ProfilePhotoUpload profileImageUrl={user?.profile_image_url} onUpload={onProfileImageUpload} />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-[11px] font-extrabold text-brand-800 ring-1 ring-brand-100">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" /> {t('role.engineer')}
          </span>
          <p className="text-center text-[11px] font-medium text-slate-500">{t('dash.engineer.profileVisibleNote')}</p>
        </div>

        {editing ? (
          <form id="engineer-profile-form" className="space-y-3" onSubmit={submitProfile}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <label className="grid gap-1 text-xs font-bold text-slate-600">
                <span>{t('dash.engineer.fullName')}{requiredFields.has('name') && <RequiredMark />}</span>
                <input ref={registerField('name')} className={fieldClass('name')} value={form.name} onChange={(event) => update('name', event.target.value)} />
                <FieldError message={fieldErrors.name} />
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-600">
                <span>{t('dash.common.email')}{requiredFields.has('email') && <RequiredMark />}</span>
                {/* The account's email, shown so this required field is visible here
                    as it already is on the other dashboards. It is not editable in
                    any profile screen, so it stays out of the form state and out of
                    the save payload. */}
                <input className={readOnlyInputClass} value={user?.email || ''} readOnly />
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-600">
                <span>{t('dash.common.phone')}{requiredFields.has('phone') && <RequiredMark />}</span>
                <input ref={registerField('phone')} className={fieldClass('phone')} value={form.phone} onChange={(event) => update('phone', event.target.value.replace(/\D/g, '').slice(-10))} />
                <FieldError message={fieldErrors.phone} />
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-600">
                <span>{t('dash.common.address')}{requiredFields.has('address') && <RequiredMark />}</span>
                <input ref={registerField('address')} className={fieldClass('address')} value={form.address} onChange={(event) => update('address', event.target.value)} />
                <FieldError message={fieldErrors.address} />
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-600">
                <span>{t('dash.common.pincode')}{requiredFields.has('pincode') && <RequiredMark />}</span>
                <input ref={registerField('pincode')} className={fieldClass('pincode')} value={form.pincode} onChange={(event) => update('pincode', event.target.value.replace(/\D/g, '').slice(-6))} />
                <PincodeAreaHint lookupState={pincodeLookupState} />
                <FieldError message={fieldErrors.pincode} />
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-600">
                <span>{t('dash.engineer.experienceYears')}</span>
                <input ref={registerField('experience_years')} className={fieldClass('experience_years')} type="number" min="0" value={form.experience_years} onChange={(event) => update('experience_years', event.target.value)} />
                <FieldError message={fieldErrors.experience_years} />
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-600">
                <span>{t('dash.engineer.qualification')}</span>
                <input ref={registerField('qualification')} className={fieldClass('qualification')} value={form.qualification} onChange={(event) => update('qualification', event.target.value)} placeholder={t('ps.eng.qualificationPlaceholder')} />
                <FieldError message={fieldErrors.qualification} />
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-600">
                <span>{t('profile.engineerCategory')}{requiredFields.has('specialization') && <RequiredMark />}</span>
                {/* Saved to the existing engineer_profiles.specialization column
                    through the same profile-save call the rest of this form uses. */}
                <select ref={registerField('specialization')} className={fieldClass('specialization')} value={form.specialization} onChange={(event) => update('specialization', event.target.value)}>
                  <option value="">{t('profile.engineerCategorySelect')}</option>
                  {categoryChoices.map((category) => (
                    <option key={category} value={category}>{optionLabel(t, ENGINEER_CATEGORY_LABEL_KEYS, category)}</option>
                  ))}
                </select>
                <FieldError message={fieldErrors.specialization} />
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-600">
                <span>{t('dash.engineer.licenseNumber')}</span>
                <input ref={registerField('license_number')} className={fieldClass('license_number')} value={form.license_number} onChange={(event) => update('license_number', event.target.value)} />
                <FieldError message={fieldErrors.license_number} />
              </label>
            </div>
            <label className="grid gap-1 text-xs font-bold text-slate-600">
              <span>{t('dash.msg.about')}</span>
              <textarea
                ref={registerField('about')}
                value={form.about}
                onChange={(event) => update('about', event.target.value)}
                rows="3"
                placeholder={t('dash.engineer.aboutPlaceholder')}
                className={`min-h-20 rounded-lg border px-3 py-2 text-sm font-semibold text-slate-800 outline-none transition placeholder:text-slate-400 ${
                  fieldErrors.about ? INVALID_FIELD_CLASS : 'border-slate-200 bg-white focus:border-brand-500 focus:ring-2 focus:ring-brand-100'
                }`}
              />
              <FieldError message={fieldErrors.about} />
            </label>
          </form>
        ) : (
          <div className="grid grid-cols-1 gap-x-8 gap-y-0 md:grid-cols-2">
            <EngineerDetailRow required={requiredFields.has('name')} label={t('dash.engineer.fullName')} value={td(user?.name)} />
            <EngineerDetailRow required={requiredFields.has('email')} label={t('dash.common.email')} value={user?.email} />
            <EngineerDetailRow required={requiredFields.has('phone')} label={t('dash.common.phone')} value={user?.phone} />
            <EngineerDetailRow required={requiredFields.has('address')} label={t('dash.common.address')} value={td(user?.address)} />
            <EngineerDetailRow required={requiredFields.has('pincode')} label={t('dash.common.pincode')} value={user?.pincode} />
            <EngineerDetailRow required={requiredFields.has('specialization')} label={t('profile.engineerCategory')} value={profile?.specialization && optionLabel(t, ENGINEER_CATEGORY_LABEL_KEYS, profile.specialization)} />
            <EngineerDetailRow label={t('dash.engineer.experienceYears')} value={profile?.experience_years} />
            <EngineerDetailRow label={t('dash.engineer.qualification')} value={td(profile?.qualification)} />
            <EngineerDetailRow label={t('dash.engineer.licenseNumber')} value={profile?.license_number} />
            <EngineerDetailRow label={t('dash.msg.about')} value={td(profile?.about)} />
          </div>
        )}

        {saveMessage && <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-800">{saveMessage}</p>}
        {uploadMessage && <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-800">{uploadMessage}</p>}
      </section>

      {/* One Save for the whole profile, at the bottom of the edit section, and
          only while editing. No field saves on its own. */}
      {editing && (
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
          {(formError || errorMessage) && (
            <p className="mr-auto min-w-0 text-sm font-bold text-rose-700">{formError || errorMessage}</p>
          )}
          <button
            type="button"
            onClick={cancelEdits}
            disabled={saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-xs font-extrabold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" /> {t('ce.cancel')}
          </button>
          <button
            type="submit"
            form="engineer-profile-form"
            disabled={saving}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-600 px-5 text-xs font-extrabold text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? t('dash.common.saving') : t('dash.engineer.saveProfile')}
          </button>
        </div>
      )}
    </div>
  )
}


function ProfilePhotoUpload({ profileImageUrl, onUpload }) {
  const { t } = useLanguage()
  // A real ref: the button opens the hidden picker through fileInputRef.current.
  const fileInputRef = useRef(null)
  return (
    <div className="flex flex-col items-center gap-2.5">
      {/* Settings shows the very same avatar the rest of the app shows for
          this Site Engineer, so the picture here is never a surprise. */}
      <SmartImage src={avatarFromPath(profileImageUrl, 'ENGINEER')} alt={t('ps.profileFallback')} className="h-28 w-28 rounded-2xl object-cover ring-2 ring-brand-100" />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-extrabold text-slate-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
      >
        {t('dash.engineer.uploadPhoto')}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept={PROFILE_IMAGE_ACCEPT}
        className="hidden"
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; onUpload(file) }}
      />
      <ProfileImageHint className="text-center" />
    </div>
  )
}

export function ContractorProfileModal({ contractor, profile, onClose, onRequestJoin, requestState, message }) {
  const { t, td } = useLanguage()
  const data = profile || contractor || {}
  const contactVisible = profile?.can_view_contact
  return (
    <div className="fixed inset-0 z-[120] grid place-items-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-5 py-3.5 backdrop-blur">
          <p className="text-sm font-extrabold text-slate-950">{t('dash.contractor.builderProfile')}</p>
          <button type="button" onClick={onClose} aria-label={t('dash.common.close')} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div className="flex items-center gap-4">
            <SmartImage
              src={data.company_logo_url ? imageUrl(data.company_logo_url) : userAvatarSrc(data, 'BUILDER')}
              alt={td(data.company_name)}
              className="h-16 w-16 shrink-0 rounded-2xl object-cover"
            />
            <div className="min-w-0">
              <h3 className="truncate font-display text-lg font-extrabold text-slate-950">{td(data.company_name)}</h3>
              <p className="flex items-center gap-1 text-xs font-bold text-brand-700">
                <Star className="h-3.5 w-3.5 fill-brand-500 text-brand-500" /> {ratingLabel(data.rating, data.review_count, t)}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <MapPin className="h-3.5 w-3.5 text-brand-700" /> {[td(data.address || ''), data.pincode || ''].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2.5">
              <p className="text-base font-extrabold text-slate-900">{data.experience_years || 0} {t('dash.supplier.yrs')}</p>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t('dash.msg.experience')}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2.5">
              <p className="text-base font-extrabold text-slate-900">{data.completed_projects || 0}</p>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t('dash.supplier.projects')}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2.5">
              <p className="text-base font-extrabold text-slate-900">{data.team_size || '—'}</p>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t('dash.contractor.teamSize')}</p>
            </div>
          </div>

          {data.about && <p className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-sm font-medium leading-relaxed text-slate-600">{td(data.about)}</p>}

          {(data.services_offered || []).length > 0 && (
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400">{t('dash.msg.services')}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {/* The stored service values are the ones the Builder's own
                    profile form offers, so they read from the shared option
                    table; anything else a builder saved is translated as text. */}
                {data.services_offered.map((service) => (
                  <span key={service} className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-extrabold text-brand-800 ring-1 ring-brand-100">
                    {SERVICE_OPTION_KEYS[service] ? t(SERVICE_OPTION_KEYS[service]) : td(service)}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
              <Mail className="h-4 w-4 shrink-0 text-brand-700" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase text-slate-400">{t('dash.common.email')}</p>
                <p className={`truncate text-sm font-bold text-slate-800 ${contactVisible ? '' : 'select-none blur-sm'}`}>{data.email || '—'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
              <Phone className="h-4 w-4 shrink-0 text-brand-700" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase text-slate-400">{t('dash.common.phone')}</p>
                <p className={`truncate text-sm font-bold text-slate-800 ${contactVisible ? '' : 'select-none blur-sm'}`}>{data.phone || '—'}</p>
              </div>
            </div>
          </div>

          {message && <p className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-2.5 text-sm font-bold text-brand-800">{message}</p>}

          <div className="flex gap-2">
            {requestState === 'active' ? (
              <span className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-50 text-sm font-extrabold text-emerald-700">
                <CheckCircle2 className="h-4 w-4" /> {t('dash.engineer.activeTeamMember')}
              </span>
            ) : requestState === 'pending' ? (
              <span className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-brand-50 text-sm font-extrabold text-brand-700">
                <Clock className="h-4 w-4" /> {t('dash.engineer.joinRequestPending')}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onRequestJoin(data.user_id || data.contractor_id)}
                className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-brand-600 text-sm font-extrabold text-white transition hover:bg-brand-700"
              >
                <UserRound className="h-4 w-4" /> {t('dash.engineer.requestToJoin')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function OpportunityDetailModal({ opportunity, onClose, onApply, applied, message }) {
  const { t, td } = useLanguage()
  return (
    <div className="fixed inset-0 z-[120] grid place-items-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-5 py-3.5 backdrop-blur">
          <p className="text-sm font-extrabold text-slate-950">{t('dash.engineer.opportunityDetails')}</p>
          <button type="button" onClick={onClose} aria-label={t('dash.common.close')} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="inline-flex rounded-full bg-brand-50 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-brand-800 ring-1 ring-brand-200">
                {t('dash.engineer.siteEngineerRequired')}
              </span>
              <h3 className="mt-2 font-display text-xl font-extrabold text-slate-950">{td(opportunity.title)}</h3>
              <p className="mt-1 flex items-center gap-1.5 text-sm font-bold text-slate-600">
                <Building2 className="h-4 w-4 text-brand-700" /> {td(opportunity.company_name)}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-sm font-extrabold text-slate-700">{inr(opportunity.budget)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
              <MapPin className="h-4 w-4 shrink-0 text-brand-700" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase text-slate-400">{t('dash.common.pincode')}</p>
                <p className="truncate text-sm font-bold text-slate-800">{opportunity.pincode}</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
              <FileText className="h-4 w-4 shrink-0 text-brand-700" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase text-slate-400">{t('dash.common.type')}</p>
                <p className="truncate text-sm font-bold text-slate-800">{constructionTypeLabel(opportunity.construction_type) || '—'}</p>
              </div>
            </div>
          </div>
          <p className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-sm font-medium leading-relaxed text-slate-600">{td(opportunity.description)}</p>
          {message && <p className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-2.5 text-sm font-bold text-brand-800">{message}</p>}
          {applied ? (
            <span className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-emerald-50 text-sm font-extrabold text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> {t('dash.engineer.applicationSent')}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onApply(opportunity)}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 text-sm font-extrabold text-white transition hover:bg-brand-700"
            >
              {t('dash.engineer.applyForOpportunity')} <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
