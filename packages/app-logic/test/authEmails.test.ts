import { describe, expect, it } from 'vitest';
import { authEmailConfig } from '../src/authEmails';
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
      expect(c.mailer_subjects_magic_link).toContain(DICTIONARIES[l]['email.login.subject']);
      if (l !== 'en') expect(c.mailer_templates_magic_link_content).toContain(`eq .Data.lang "${l}"`);
    }
  });

  it('a Go-sablon ágai zártak: az alapértelmezés angol', () => {
    const html = c.mailer_subjects_magic_link;
    expect(html.startsWith('{{ if eq .Data.lang')).toBe(true);
    expect(html.endsWith('{{ end }}')).toBe(true);
    expect(html).toContain(`{{ else }}${DICTIONARIES.en['email.login.subject']}{{ end }}`);
  });
});
