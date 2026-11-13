import {
  Facebook,
  Instagram,
  Linkedin,
  Mail,
  MapPin,
  Phone,
  Clock,
} from "lucide-react";
import { Brand, containerClass } from "./shared.jsx";
import { roleDestination, roleMeta } from "./content.js";
import { useEffect, useState } from "react";
import { useLanguage } from "../../../../i18n/LanguageContext.jsx";
import { fetchSupportConfig } from "../../../support/supportApi.js";

const columnHeading = "m-0 text-[10px] font-extrabold uppercase tracking-[.16em] text-oc-amber rtl:tracking-normal";
const columnList = "flex flex-col gap-[13px] mt-[22px] p-0 list-none text-xs font-semibold leading-[1.6] text-[#b6bfb8]";
const columnLink = "transition-colors duration-200 hover:text-oc-amber";
const socialLink =
  "grid place-items-center w-[38px] h-[38px] rounded-full border border-[rgba(244,183,64,.3)] text-oc-amber " +
  "transition-[background,color,transform] duration-200 ease-soft hover:bg-oc-amber hover:text-oc-night hover:-translate-y-[3px]";

function ContactRow({ icon: Icon, children }) {
  return (
    <li className="flex items-start gap-[10px]">
      <Icon size={15} className="shrink-0 mt-px text-oc-amber" />
      {children}
    </li>
  );
}

export function SiteFooter({ text, language, onSelectLanguage }) {
  const { languages } = useLanguage();
  // Email, phone and hours come from GET /support/config -- the backend's
  // SUPPORT_EMAIL / SUPPORT_PHONE / SUPPORT_HOURS, the same values the Contact &
  // Support page shows -- so the footer never carries its own (it showed a Kuwait
  // number and a .com.kw address). Anything not configured is simply not shown.
  const [contact, setContact] = useState(null);
  useEffect(() => {
    let active = true;
    fetchSupportConfig()
      .then((config) => { if (active) setContact(config?.contact || null); })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  const languageButton = (code) =>
    `p-0 border-0 bg-transparent text-[11px] transition-colors duration-200 hover:text-oc-amber ${
      language === code ? "text-oc-amber font-extrabold" : "text-[#98a19a] font-semibold"
    }`;

  return (
    <footer className="bg-oc-night text-[#f2f5f2] pt-[78px] pb-[26px] max-wide:pt-14 max-wide:pb-[22px]">
      <div className={containerClass}>
        <div className="grid grid-cols-[1.6fr_1fr_1fr_1.15fr] gap-[46px] max-wide:grid-cols-2 max-wide:gap-[34px]">
          <div className="max-w-[340px] max-wide:col-span-full max-wide:max-w-none">
            <Brand href="#top" />
            <p className="mt-5 text-xs leading-[1.8] text-[#98a19a]">{text.footer.tagline}</p>
            <div className="flex gap-[10px] mt-[26px]">
              <a className={socialLink} href="https://www.instagram.com/crewnbuild" target="_blank" rel="noopener noreferrer" aria-label="CREWNBUILD on Instagram"><Instagram size={17} /></a>
              <a className={socialLink} href="#linkedin" aria-label="CREWNBUILD on LinkedIn"><Linkedin size={17} /></a>
              <a className={socialLink} href="https://www.facebook.com/profile.php?id=61595250186584" target="_blank" rel="noopener noreferrer" aria-label="CREWNBUILD on Facebook"><Facebook size={17} /></a>
            </div>
          </div>

          <div>
            <h4 className={columnHeading}>{text.footer.platform}</h4>
            <ul className={columnList}>
              <li><a className={columnLink} href="#roles">{text.nav.roles}</a></li>
              <li><a className={columnLink} href="#how">{text.nav.how}</a></li>
              <li><a className={columnLink} href="#world">{text.nav.world}</a></li>
              <li><a className={columnLink} href="/signup">{text.nav.start}</a></li>
              <li><a className={columnLink} href="/login">{text.nav.signIn}</a></li>
            </ul>
          </div>

          <div>
            <h4 className={columnHeading}>{text.footer.forYou}</h4>
            <ul className={columnList}>
              {/* Each role goes straight to its own sign-up, or to the coming-soon page
                  while the module is still in development. */}
              {text.roles.map((role, index) => (
                <li key={role.title}>
                  <a className={columnLink} href={roleDestination(roleMeta[index].key)}>
                    {role.title}
                    {roleMeta[index].comingSoon && (
                      <span className="ms-2 text-[9px] font-extrabold uppercase tracking-[.08em] text-oc-amber rtl:tracking-normal">
                        {text.comingSoon}
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className={columnHeading}>{text.footer.contact}</h4>
            <ul className={columnList}>
              {/* Contact details live on the Contact Us page, which shows only the
                  channels configured on the server (GET /support/config). */}
              <ContactRow icon={Mail}><a className={columnLink} href="/contact-us">{text.nav.contactUs}</a></ContactRow>
              <ContactRow icon={MapPin}><span>{text.footer.city}</span></ContactRow>
              {contact?.email && (
                <ContactRow icon={Mail}><a className={`${columnLink} min-w-0 [overflow-wrap:anywhere]`} href={`mailto:${contact.email}`} dir="ltr">{contact.email}</a></ContactRow>
              )}
              {contact?.phone && (
                <ContactRow icon={Phone}><a className={columnLink} href={contact.phone_href} dir="ltr">{contact.phone}</a></ContactRow>
              )}
              {contact?.hours && <ContactRow icon={Clock}><span>{contact.hours}</span></ContactRow>}
            </ul>
          </div>
        </div>

        <div className="h-px my-[54px] mb-[22px] bg-[linear-gradient(90deg,var(--color-amber),rgba(244,183,64,.14)_42%,rgba(255,255,255,.06))]
                        rtl:bg-[linear-gradient(270deg,var(--color-amber),rgba(244,183,64,.14)_42%,rgba(255,255,255,.06))]
                        max-wide:mt-[38px] max-wide:mb-[18px]" />

        <div className="flex flex-wrap items-center justify-between gap-5 text-[11px] text-[#7b847d] max-wide:block">
          <span>© {new Date().getFullYear()} CREWNBUILD. {text.footer.rights}</span>

          <div className="flex gap-[22px] max-wide:flex-wrap max-wide:gap-x-5 max-wide:gap-y-3 max-wide:mt-[13px]">
            <a className="transition-colors duration-200 hover:text-oc-amber" href="#privacy">{text.footer.privacy}</a>
            <a className="transition-colors duration-200 hover:text-oc-amber" href="#terms">{text.footer.terms}</a>
            <a className="transition-colors duration-200 hover:text-oc-amber" href="#cookies">{text.footer.cookies}</a>
          </div>

          {/* Powered by Trysol: the supplied image (logo + name) as is, only sized down. */}
          <div className="flex items-center gap-2 max-wide:mt-[13px]" dir="ltr">
            <span className="font-semibold">Powered by</span>
            <a href="https://trysol.com/" target="_blank" rel="noopener noreferrer" aria-label="Trysol (opens in a new tab)" className="inline-flex">
              <img src="/trysol-brand.jpg" alt="Trysol" className="h-[28px] w-auto object-contain" />
            </a>
          </div>

          {/* All seven languages. This row offered only English and Arabic
              while the app shipped five more, so a Telugu or Tamil reader had
              no way back to their own language from the footer. Wraps rather
              than overflowing, since seven endonyms are wider than two. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 max-wide:mt-[13px]" aria-label={text.footer.language}>
            {languages.map(({ code, name }, index) => (
              <span key={code} className="inline-flex items-center">
                {index > 0 && <b className="me-2 text-oc-amber" aria-hidden="true">|</b>}
                <button
                  type="button"
                  lang={code}
                  className={languageButton(code)}
                  onClick={() => onSelectLanguage(code)}
                  aria-pressed={language === code}
                >
                  {name}
                </button>
              </span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
