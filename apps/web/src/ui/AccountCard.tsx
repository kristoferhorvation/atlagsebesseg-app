import { useEffect, useState } from 'react';
import { accountTitle, getLanguage, LOCALES, MEGSZOLITAS_MAX, syncStatusText, t, validEmail, type Settings } from '@atlagsebesseg/app-logic';
import type { AccountApi } from '../hooks/useAccount';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

/** A Google hivatalos, négyszínű „G” jele (a színek a tokenekből). */
function GoogleMark() {
  const parts = [
    ['googleB', 'var(--color-google-blue)'],
    ['googleG', 'var(--color-google-green)'],
    ['googleY', 'var(--color-google-yellow)'],
    ['googleR', 'var(--color-google-red)'],
  ] as const;
  return (
    <span className="google-mark" aria-hidden="true">
      {parts.map(([name, color]) => (
        <span key={name} style={{ color }}>
          <Icon name={name} size={20} />
        </span>
      ))}
    </span>
  );
}

/**
 * AW22: a Beállítások „Fiók” kártyája a lap tetején (iOS-pár: `AccountViews.swift`). Kijelentkezve: az Apple-gomb az elsődleges, nagy gomb,
 * alatta kisebben a Google és az e-mail (magic link, jelszó nincs). Bejelentkezve: név / e-mail, a szinkron állapota, felhős mentés,
 * kijelentkezés, fiók törlése megerősítéssel. A be nem állított szolgáltatót felirat jelzi, nem hiba.
 */
export function AccountCard({ account, settings, update }: { account: AccountApi; settings: Settings; update: (p: Partial<Settings>) => void }) {
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { user, signedIn, providers, busy, error, emailSentTo } = account;

  if (signedIn && user) {
    const time = (ms: number) => new Date(ms).toLocaleTimeString(LOCALES[getLanguage()], { hour: '2-digit', minute: '2-digit' });
    return (
      <>
        <div className="group-label">{t('account.title')}</div>
        <div className="list" data-testid="account-card" data-state="in">
          <div className="list-row">
            <div style={{ minWidth: 0 }}>
              <div className="label">{accountTitle(user, settings.megszolitas)}</div>
              {user.email && <div className="hint">{user.email}</div>}
              <div className="hint" data-testid="account-sync" data-status={account.status}>
                {syncStatusText(account.status, account.lastSync, time)}
              </div>
            </div>
          </div>
          <div className="list-row">
            <div>
              <div className="label">{t('account.backup')}</div>
              <div className="hint">{t('account.backupHint')}</div>
            </div>
            <button className="switch" role="switch" aria-checked={settings.felho_mentes} aria-label={t('account.backup')} onClick={() => update({ felho_mentes: !settings.felho_mentes })} />
          </div>
          <div className="list-row stacked">
            <button className="mini-btn wide" data-testid="account-signout" disabled={busy} onClick={account.signOut}>
              {t('account.signOut')}
            </button>
            <div className="hint">{t('account.signOutHint')}</div>
            {confirmDelete ? (
              <div className="delete-all-panel" role="dialog" aria-label={t('account.delete')} data-testid="account-delete-panel">
                <div className="label">{t('account.delete')}</div>
                <div className="hint">{t('account.delete.body')}</div>
                <div className="mini-btns account-delete-btns">
                  <button className="mini-btn" onClick={() => setConfirmDelete(false)}>
                    {t('account.cancel')}
                  </button>
                  <button className="mini-btn danger" data-testid="account-delete-confirm" disabled={busy} onClick={account.remove}>
                    {t('account.delete.confirm')}
                  </button>
                </div>
              </div>
            ) : (
              <button className="mini-btn wide danger" data-testid="account-delete" onClick={() => setConfirmDelete(true)}>
                {t('account.delete')}
              </button>
            )}
          </div>
          {error && <div className="list-row account-error" role="alert">{error}</div>}
        </div>
      </>
    );
  }

  const notConfigured = !providers.apple || !providers.google;
  return (
    <>
      <div className="group-label">{t('account.title')}</div>
      <div className="list" data-testid="account-card" data-state="out">
        <div className="list-row stacked">
          <div className="hint">{t('account.hint')}</div>
          <button className="btn apple-btn" data-testid="account-apple" disabled={busy || !providers.apple} onClick={() => account.signIn('apple')}>
            <Icon name="apple" size={22} />
            {t('account.apple')}
          </button>
          <div className="account-small-btns">
            <button className="mini-btn account-small-btn" data-testid="account-google" disabled={busy || !providers.google} onClick={() => account.signIn('google')}>
              <GoogleMark />
              {t('account.google')}
            </button>
            <button className="mini-btn account-small-btn" data-testid="account-email" aria-expanded={emailOpen} onClick={() => setEmailOpen((o) => !o)}>
              <Icon name="mail" size={20} />
              {t('account.email')}
            </button>
          </div>
          {notConfigured && <div className="hint" data-testid="account-not-configured">{t('account.notConfigured')}</div>}
          {emailOpen && !emailSentTo && (
            <form
              className="account-email-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (validEmail(email)) account.sendEmail(email);
              }}
            >
              <input className="select text-input" type="email" autoComplete="email" inputMode="email" aria-label={t('account.emailPlaceholder')} placeholder={t('account.emailPlaceholder')} value={email} onChange={(e) => setEmail(e.target.value)} />
              <button className="mini-btn wide" type="submit" data-testid="account-email-send" disabled={busy || !validEmail(email)}>
                {t('account.emailSend')}
              </button>
              <div className="hint">{t('account.emailHint')}</div>
            </form>
          )}
          {emailSentTo && (
            <div className="hint" data-testid="account-email-sent" role="status">
              {t('account.emailSent', { email: emailSentTo })}
            </div>
          )}
          {error && <div className="hint account-error" role="alert">{error}</div>}
        </div>
      </div>
    </>
  );
}

/** Az első bejelentkezés utáni könnyű, kihagyható lépés: „Így szólítsunk?”. */
export function NameStepSheet({ initial, onSave, onSkip }: { initial: string; onSave: (name: string) => void; onSkip: () => void }) {
  const [name, setName] = useState(initial);
  useEffect(() => setName(initial), [initial]);
  return (
    <Sheet title={t('account.name.title')} onClose={onSkip}>
      <div className="account-name-step" data-testid="name-step">
        <input className="select text-input" type="text" autoComplete="given-name" maxLength={MEGSZOLITAS_MAX} aria-label={t('settings.name')} placeholder={t('settings.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
        <div className="btn-row">
          <button className="btn" data-testid="name-skip" onClick={onSkip}>
            {t('account.name.skip')}
          </button>
          <button className="btn primary" data-testid="name-save" disabled={name.trim() === ''} onClick={() => onSave(name)}>
            {t('account.name.save')}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/** A befejezett út utáni, kihagyható ajánlat (legfeljebb egyszer, 30 napig nem jön újra). */
export function SignInNudge({ onSignIn, onLater }: { onSignIn: () => void; onLater: () => void }) {
  return (
    <section className="report-card glass account-nudge" data-testid="account-nudge" aria-label={t('account.nudge.text')}>
      <div className="body account-nudge-text">{t('account.nudge.text')}</div>
      <div className="btn-row">
        <button className="btn" data-testid="nudge-later" onClick={onLater}>
          {t('account.nudge.later')}
        </button>
        <button className="btn primary" data-testid="nudge-signin" onClick={onSignIn}>
          {t('account.nudge.action')}
        </button>
      </div>
    </section>
  );
}
