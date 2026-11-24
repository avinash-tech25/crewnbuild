import {
  Facebook,
  Instagram,
  Linkedin,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Clock,
} from "lucide-react";
import { Brand, containerClass } from "./shared.jsx";
import { roleDestination, roleMeta } from "./content.js";
import { useEffect, useState } from "react";
import { useLanguage } from "../../../../i18n/LanguageContext.jsx";
import { Link } from "react-router-dom";
import { AppLink } from "../../../../shared/navigation/AppLink.jsx";
import { DisclaimerNote } from "../../../../shared/ui/DisclaimerNote.jsx";
import { useAccountLinks } from "../../../../shared/auth/sessionLinks.js";
import { WhatsAppGlyph } from "../../../auth/components/WhatsAppGlyph.jsx";
import { fetchSupportConfig } from "../../../support/supportApi.js";
import { SUPPORT_PHONE, phoneHref } from "../../../../shared/constants/support.js";

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
  const { languages, t } = useLanguage();
  const accountHome = useAccountLinks().links?.home;
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
        <div className="grid grid-cols-[1.6fr_1fr_1fr_.8fr_1.15fr] gap-[46px] max-wide:grid-cols-2 max-wide:gap-[34px]">
          <div className="max-w-[340px] max-wide:col-span-full max-wide:max-w-none">
            <Brand href="#top" logoOnly />
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
              {accountHome ? (
                // Signed in: Dashboard, not Sign in / Get started.
                <li><Link className={columnLink} to={accountHome}>{t("ui.dashboard")}</Link></li>
              ) : (
                <>
                  <li><AppLink className={columnLink} href="/signup">{text.nav.start}</AppLink></li>
                  <li><AppLink className={columnLink} href="/login">{text.nav.signIn}</AppLink></li>
                </>
              )}
            </ul>
          </div>

          <div>
            <h4 className={columnHeading}>{text.footer.forYou}</h4>
            <ul className={columnList}>
              {/* Each role goes straight to its own sign-up, or to the coming-soon page
                  while the module is still in development. */}
              {text.roles.map((role, index) => (
                <li key={role.title}>
                  <AppLink className={columnLink} href={roleDestination(roleMeta[index].key)}>
                    {role.title}
                    {roleMeta[index].comingSoon && (
                      <span className="ms-2 text-[9px] font-extrabold uppercase tracking-[.08em] text-oc-amber rtl:tracking-normal">
                        {text.comingSoon}
                      </span>
                    )}
                  </AppLink>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className={columnHeading}>{t("site.footer.col.legal")}</h4>
            <ul className={columnList}>
              <li><Link className={columnLink} to="/legal">{t("legal.hub.title")}</Link></li>
              <li><Link className={columnLink} to="/terms">{text.footer.terms}</Link></li>
              <li><Link className={columnLink} to="/privacy">{text.footer.privacy}</Link></li>
              <li><Link className={columnLink} to="/disclaimer">{t("site.footer.link.disclaimer")}</Link></li>
            </ul>
          </div>

          <div>
            <h4 className={columnHeading}>{text.footer.contact}</h4>
            <ul className={columnList}>
              {/* Contact details live on the Contact Us page, which shows only the
                  channels configured on the server (GET /support/config). */}
              <ContactRow icon={MessageCircle}><AppLink className={columnLink} href="/contact-us">{text.nav.contactUs}</AppLink></ContactRow>
              <ContactRow icon={MapPin}><span>{text.footer.city}</span></ContactRow>
              {contact?.email && (
                <ContactRow icon={Mail}><a className={`${columnLink} min-w-0 [overflow-wrap:anywhere]`} href={`mailto:${contact.email}`} dir="ltr">{contact.email}</a></ContactRow>
              )}
              {/* SUPPORT_PHONE from the server; the company line until it answers. */}
              <ContactRow icon={Phone}>
                <a className={columnLink} href={contact?.phone_href || phoneHref(SUPPORT_PHONE)} dir="ltr">{contact?.phone || SUPPORT_PHONE}</a>
              </ContactRow>
              {/* Only when the server has a WhatsApp number, as on the Contact us page. */}
              {contact?.whatsapp && contact?.whatsapp_href && (
                <li className="flex items-start gap-[10px] [&_svg]:mt-px [&_svg]:h-[15px] [&_svg]:w-[15px]">
                  <WhatsAppGlyph />
                  <a className={columnLink} href={contact.whatsapp_href} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${contact.whatsapp}`} dir="ltr">{contact.whatsapp}</a>
                </li>
              )}
              {contact?.hours && <ContactRow icon={Clock}><span>{contact.hours}</span></ContactRow>}
            </ul>
          </div>
        </div>

        <div className="h-px my-[54px] mb-[22px] bg-[linear-gradient(90deg,var(--color-amber),rgba(244,183,64,.14)_42%,rgba(255,255,255,.06))]
                        rtl:bg-[linear-gradient(270deg,var(--color-amber),rgba(244,183,64,.14)_42%,rgba(255,255,255,.06))]
                        max-wide:mt-[38px] max-wide:mb-[18px]" />

        <div className="flex flex-wrap items-center justify-between gap-5 text-[11px] text-[#a8b1aa] max-wide:block">
          <span>© {new Date().getFullYear()} CREWNBUILD. {text.footer.rights}</span>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 max-wide:block">
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
        <DisclaimerNote kind="language" tone="dark" className="mt-3" />
      </div>
    </footer>
  );
}
