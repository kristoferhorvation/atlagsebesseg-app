import { useEffect, useState } from 'react';
import { accountTitle, avatarInitials, greetingPreview, MEGSZOLITAS_MAX, normalizeName, t, validEmail, type Settings } from '@atlagsebesseg/app-logic';
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
 * AW22 + AW24: a Beállítások teteje (iOS-pár: `AccountViews.swift`, INV-20). Kijelentkezve: az Apple-gomb az elsődleges, nagy gomb, alatta kisebben a Google és az e-mail (magic link, jelszó nincs).
 * Bejelentkezve: kör alakú profilkép, név, e-mail. Mindkét esetben alatta a Megszólítás. A felhős mentés és a fiók törlése az Adatvédelem blokkban, a kijelentkezés a lap legalján.
 */
export function AccountCard({ account, settings, update }: { account: AccountApi; settings: Settings; update: (p: Partial<Settings>) => void }) {
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState('');
  const { user, signedIn, providers, busy, error, emailSentTo } = account;

  if (signedIn && user) {
    const name = accountTitle(user, settings.megszolitas);
    return (
      <>
        <div className="account-profile" data-testid="account-card" data-state="in" data-sync={account.status}>
          <Avatar account={account} name={name} />
          <div className="account-profile-name">{name}</div>
          {user.email && user.email !== name && <div className="account-profile-email">{user.email}</div>}
        </div>
        <NameRow settings={settings} update={update} />
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
      <NameRow settings={settings} update={update} />
    </>
  );
}

/** A kör alakú profilkép: a választott kép, különben a szolgáltató képe, különben monogram. Érintésre a fotótár. */
function Avatar({ account, name }: { account: AccountApi; name: string }) {
  const [broken, setBroken] = useState(false);
  const src = account.avatar ?? account.user?.avatarUrl ?? null;
  useEffect(() => setBroken(false), [src]);
  return (
    <label className="avatar" data-testid="account-avatar">
      {src && !broken ? <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : <span>{avatarInitials(name, account.user?.email)}</span>}
      <input
        type="file"
        accept="image/*"
        aria-label={t('account.avatar.change')}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) account.setAvatarFile(f);
          e.target.value = '';
        }}
      />
    </label>
  );
}

/** A Megszólítás mező: a magyarázat a megadott névvel, élőben. */
function NameRow({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => void }) {
  return (
    <div className="list account-name-list">
      <div className="list-row stacked">
        <div>
          <div className="label">{t('settings.name')}</div>
          <div className="hint" data-testid="name-hint">{greetingPreview(settings.megszolitas)}</div>
        </div>
        <input
          className="select text-input"
          type="text"
          autoComplete="given-name"
          maxLength={MEGSZOLITAS_MAX}
          aria-label={t('settings.name')}
          placeholder={t('settings.namePlaceholder')}
          value={settings.megszolitas}
          onChange={(e) => update({ megszolitas: e.target.value })}
          onBlur={(e) => update({ megszolitas: normalizeName(e.target.value) })}
        />
      </div>
    </div>
  );
}

/** Az Adatvédelem blokk fiókos sorai: a felhős mentés kapcsolója (fent, a megosztás mellett). */
export function BackupRow({ account, settings, update }: { account: AccountApi; settings: Settings; update: (p: Partial<Settings>) => void }) {
  if (!account.signedIn) return null;
  return (
    <div className="list-row">
      <div>
        <div className="label">{t('account.backup')}</div>
        <div className="hint">{t('account.backupHint')}</div>
      </div>
      <button className="switch" role="switch" data-testid="account-backup" aria-checked={settings.felho_mentes} aria-label={t('account.backup')} onClick={() => update({ felho_mentes: !settings.felho_mentes })} />
    </div>
  );
}

/** A „Fiók törlése” az Adatvédelem blokk alján, pirosan, megerősítéssel. */
export function DeleteAccountRow({ account }: { account: AccountApi }) {
  const [confirm, setConfirm] = useState(false);
  if (!account.signedIn) return null;
  return (
    <div className="list-row stacked">
      {confirm ? (
        <div className="delete-all-panel" role="dialog" aria-label={t('account.delete')} data-testid="account-delete-panel">
          <div className="label">{t('account.delete')}</div>
          <div className="hint">{t('account.delete.body')}</div>
          <div className="mini-btns account-delete-btns">
            <button className="mini-btn" onClick={() => setConfirm(false)}>
              {t('account.cancel')}
            </button>
            <button className="mini-btn danger" data-testid="account-delete-confirm" disabled={account.busy} onClick={account.remove}>
              {t('account.delete.confirm')}
            </button>
          </div>
        </div>
      ) : (
        <button className="mini-btn wide danger" data-testid="account-delete" onClick={() => setConfirm(true)}>
          {t('account.delete')}
        </button>
      )}
    </div>
  );
}

/** A „Kijelentkezés” a Beállítások legalján, utolsó elemként. */
export function SignOutRow({ account }: { account: AccountApi }) {
  if (!account.signedIn) return null;
  return (
    <div className="list account-signout-list">
      <div className="list-row stacked">
        <button className="mini-btn wide" data-testid="account-signout" disabled={account.busy} onClick={account.signOut}>
          {t('account.signOut')}
        </button>
        <div className="hint">{t('account.signOutHint')}</div>
        {account.error && <div className="hint account-error" role="alert">{account.error}</div>}
      </div>
    </div>
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
