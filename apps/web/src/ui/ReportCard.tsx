import { reportVisual, t, timeAgo, type ActiveReport } from '@atlagsebesseg/app-logic';
import { Icon } from './Icon';

/**
 * Koppintásra (vagy AOS14 óta közeledéskor, „Még ott van?” kérdéssel) megjelenő kis kártya egy térképi bejelentéshez: típus, mikor jelentették,
 * megerősítés / nincs ott (report_votes). Vezetés közben is kezelhető: minden gomb ≥ 56 px.
 */
export function ReportCard({
  report,
  now,
  canVote,
  voted,
  sending,
  prompt = false,
  onVote,
  onClose,
}: {
  report: ActiveReport;
  now: number;
  canVote: boolean;
  /** A saját korábbi szavazat (`null`: még nem szavazott). */
  voted: boolean | null;
  sending: boolean;
  /** AOS14: közeledéskor magától nyílt – „Még ott van?” kérdés, Igen / Nem gombbal. */
  prompt?: boolean;
  onVote: (confirm: boolean) => void;
  onClose: () => void;
}) {
  const v = reportVisual(report);
  return (
    <section className="report-card glass" data-prompt={prompt || undefined} data-tone={v.tone} aria-label={t('report.card.aria', { label: v.label })}>
      <div className="report-card-head">
        <span className="report-card-ic">
          <Icon name={v.icon} size={28} />
        </span>
        <div className="report-card-text">
          <div className="report-card-title">{v.label}</div>
          <div className="body muted">{timeAgo(now - report.createdAt)}</div>
          {prompt && <div className="report-card-question">{t('report.prompt.question')}</div>}
        </div>
        <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
          <Icon name="close" size={22} />
        </button>
      </div>
      {report.own ? (
        <div className="body muted">{t('report.card.own')}</div>
      ) : (
        <div className="btn-row">
          <button className="btn" data-active={voted === true} disabled={!canVote || sending} onClick={() => onVote(true)}>
            <Icon name="check" /> {t(prompt ? 'report.prompt.yes' : 'report.card.confirm')}
          </button>
          <button className="btn" data-active={voted === false} disabled={!canVote || sending} onClick={() => onVote(false)}>
            <Icon name="close" /> {t(prompt ? 'report.prompt.no' : 'report.card.gone')}
          </button>
        </div>
      )}
    </section>
  );
}
