import { color } from '@atlagsebesseg/design-tokens';
import { DICTIONARIES, LANGUAGES, type Lang, type TKey } from './i18n';

/**
 * AW23: a Supabase Auth levélsablonjai (bejelentkező link, e-mail-változás) 6 nyelven, az app dizájnjához illő egyszerű HTML-lel. A Supabase
 * egy sablont tárol; a nyelvet a Go-sablon a felhasználó `lang` metaadatából választja (`.Data.lang`, az app küldi a kérésekkel), alapból angol.
 */
const text = (l: Lang, k: TKey) => DICTIONARIES[l][k] as string;

const page = (l: Lang, title: TKey, body: TKey, button: TKey) => `<div style="background:${color.bg};padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Arial,sans-serif">
<div style="max-width:440px;margin:0 auto;background:#161920;border:1px solid #2A2E38;border-radius:24px;padding:28px 24px;color:${color.text}">
<div style="font-size:14px;font-weight:600;color:#A3A9B5;margin:0 0 16px">Average Speed Nav</div>
<h1 style="font-size:24px;line-height:1.25;font-weight:700;margin:0 0 12px">${text(l, title)}</h1>
<p style="font-size:16px;line-height:1.5;margin:0 0 24px;color:#D5D8DF">${text(l, body)}</p>
<a href="{{ .ConfirmationURL }}" style="display:block;text-align:center;background:${color.accent};color:${color.bg};font-size:17px;font-weight:700;text-decoration:none;border-radius:14px;padding:16px">${text(l, button)}</a>
<p style="font-size:13px;line-height:1.5;margin:24px 0 0;color:#A3A9B5">${text(l, 'email.ignore')}</p>
</div>
</div>`;

/** Go-sablon: a `lang` metaadat szerinti ág, ismeretlen / hiányzó nyelvnél angol. */
function byLang(render: (l: Lang) => string): string {
  const rest = LANGUAGES.filter((l) => l !== 'en');
  return `${rest.map((l, i) => `{{ ${i === 0 ? 'if' : 'else if'} eq .Data.lang "${l}" }}${render(l)}`).join('')}{{ else }}${render('en')}{{ end }}`;
}

export interface AuthEmailConfig {
  mailer_subjects_magic_link: string;
  mailer_templates_magic_link_content: string;
  mailer_subjects_confirmation: string;
  mailer_templates_confirmation_content: string;
  mailer_subjects_email_change: string;
  mailer_templates_email_change_content: string;
}

/** A Management API `config/auth` mezői. A `confirmation` is a bejelentkező link: új címre ezt küldi a GoTrue. */
export function authEmailConfig(): AuthEmailConfig {
  const loginSubject = byLang((l) => text(l, 'email.login.subject'));
  const login = byLang((l) => page(l, 'email.login.title', 'email.login.body', 'email.login.button'));
  return {
    mailer_subjects_magic_link: loginSubject,
    mailer_templates_magic_link_content: login,
    mailer_subjects_confirmation: loginSubject,
    mailer_templates_confirmation_content: login,
    mailer_subjects_email_change: byLang((l) => text(l, 'email.change.subject')),
    mailer_templates_email_change_content: byLang((l) => page(l, 'email.change.title', 'email.change.body', 'email.change.button')),
  };
}
