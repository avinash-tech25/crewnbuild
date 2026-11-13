import { Linkedin, Mail } from 'lucide-react'
import { Container, Reveal, SectionHeading, SmartImage } from './ui.jsx'
import { TEAM } from './data.js'
import { useLanguage } from '../../../../i18n/LanguageContext.jsx'

const ROLE_KEYS = ['site.team.role1', 'site.team.role2', 'site.team.role3', 'site.team.role4']
const BIO_KEYS = ['site.team.bio1', 'site.team.bio2', 'site.team.bio3', 'site.team.bio4']

export default function TeamSection() {
  const { t } = useLanguage()
  return (
    <section className="bg-white py-24 sm:py-28">
      <Container>
        <SectionHeading
          eyebrow={t('site.team.eyebrow')}
          title={t('site.team.title')}
          highlight={t('site.team.highlight')}
          sub={t('site.team.sub')}
        />

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {TEAM.map((m, i) => {
            const roleKey = ROLE_KEYS[i]; const bioKey = BIO_KEYS[i]
            return (
            <Reveal key={m.name} delay={i * 0.07}>
              <article className="group relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_16px_50px_-42px_rgba(15,23,42,0.6)] transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_32px_80px_-45px_rgba(15,23,42,0.5)]">
                <div className="relative aspect-[4/5] overflow-hidden bg-slate-100">
                  <SmartImage
                    src={m.image}
                    alt={m.name}
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110 grayscale-[0.2] group-hover:grayscale-0"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                  <div className="absolute bottom-4 left-4 flex gap-2 opacity-0 transition-all duration-300 group-hover:opacity-100">
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-white/90 text-graphite backdrop-blur transition hover:bg-brand-500 hover:text-white">
                      <Linkedin className="h-4 w-4" />
                    </span>
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-white/90 text-graphite backdrop-blur transition hover:bg-brand-500 hover:text-white">
                      <Mail className="h-4 w-4" />
                    </span>
                  </div>
                </div>
                <div className="p-5">
                  <h3 className="font-display text-base font-extrabold tracking-tight text-graphite">
                    {m.name}
                  </h3>
                  <p className="mt-0.5 text-sm font-bold text-brand-600">{roleKey ? t(roleKey) : m.role}</p>
                  <p className="mt-2 text-xs leading-relaxed text-slate-500">{bioKey ? t(bioKey) : m.bio}</p>
                </div>
              </article>
            </Reveal>
            )
          })}
        </div>
      </Container>
    </section>
  )
}
