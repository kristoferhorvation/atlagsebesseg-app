import { describe, expect, it } from 'vitest';
import { accountEmail, authEmailConfig, BRAND_NAME } from '../src/authEmails';
import { DICTIONARIES, LANGUAGES } from '../src/i18n';

describe('AW23: levélsablonok', () => {
  const c = authEmailConfig();

  it('a bejelentkező link és az e-mail-változás mind a 6 nyelven, a link a sablonban', () => {
    for (const html of [c.mailer_templates_magic_link_content, c.mailer_templates_confirmation_content, c.mailer_templates_email_change_content]) {
      expect(html.split('{{ .ConfirmationURL }}').length - 1).toBe(LANGUAGES.length);
    }
    for (const l of LANGUAGES) {
      expect(c.mailer_templates_magic_link_content).toContain(DICTIONARIES[l]['email.login.button']);
      expect(c.mailer_templates_email_change_content).toContain(DICTIONARIES[l]['email.change.button']);
      expect(c.mailer_subjects_magic_link).toContain((DICTIONARIES[l]['email.login.subject'] as string).replace('{app}', BRAND_NAME));
      if (l !== 'en') expect(c.mailer_templates_magic_link_content).toContain(`eq .Data.lang "${l}"`);
    }
  });

  it('a termék neve egy kulcsból: minden sablonban és tárgyban Tempomate, a régi név sehol', () => {
    expect(BRAND_NAME).toBe('Tempomate');
    expect(JSON.stringify(c)).not.toContain('Average Speed');
    expect(JSON.stringify(c)).not.toContain('{app}');
    expect(c.mailer_templates_magic_link_content).toContain('Tempomate');
  });

  it('a Go-sablon ágai zártak: az alapértelmezés angol', () => {
    const html = c.mailer_subjects_magic_link;
    expect(html.startsWith('{{ if eq .Data.lang')).toBe(true);
    expect(html.endsWith('{{ end }}')).toBe(true);
    expect(html).toContain(`{{ else }}${(DICTIONARIES.en['email.login.subject'] as string).replace('{app}', BRAND_NAME)}{{ end }}`);
  });
});

describe('AW25: fiók-levelek', () => {
  it('üdvözlés és törlés-visszaigazolás mind a 6 nyelven, a márkanévvel és a kapcsolattal', () => {
    for (const l of LANGUAGES) {
      const w = accountEmail('welcome', l);
      const d = accountEmail('account_deleted', l);
      expect(w.lang).toBe(l);
      expect(w.subject).toBe((DICTIONARIES[l]['email.welcome.subject'] as string).replace('{app}', BRAND_NAME));
      expect(w.html).toContain(DICTIONARIES[l]['email.welcome.body']);
      expect(d.html).toContain(DICTIONARIES[l]['email.deleted.body']);
      expect(d.html).toContain('hello@tempomate.app');
      expect(w.html + d.html + w.subject + d.subject).not.toContain('{app}');
      expect(w.html).not.toContain('ConfirmationURL');
    }
  });

  it('ismeretlen vagy hiányzó nyelvnél angol', () => {
    expect(accountEmail('welcome', 'fr').lang).toBe('en');
    expect(accountEmail('account_deleted', null).subject).toBe(`Account deletion: ${BRAND_NAME}`);
  });
});
