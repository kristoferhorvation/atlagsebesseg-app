import { reportVisual, t, timeAgo, type ActiveReport } from '@atlagsebesseg/app-logic';
import { Icon } from './Icon';

/**
 * Koppintásra megjelenő kis kártya egy térképi bejelentéshez: típus, mikor jelentették,
 * megerősítés / nincs ott (report_votes). Vezetés közben is kezelhető: minden gomb ≥ 56 px.
 */
export function ReportCard({
  report,
  now,
  canVote,
  voted,
  sending,
  onVote,
  onClose,
}: {
  report: ActiveReport;
  now: number;
  canVote: boolean;
  /** A saját korábbi szavazat (`null`: még nem szavazott). */
  voted: boolean | null;
  sending: boolean;
  onVote: (confirm: boolean) => void;
  onClose: () => void;
}) {
  const v = reportVisual(report);
  return (
    <section className="report-card glass" data-tone={v.tone} aria-label={t('report.card.aria', { label: v.label })}>
      <div className="report-card-head">
        <span className="report-card-ic">
          <Icon name={v.icon} size={28} />
        </span>
        <div className="report-card-text">
          <div className="report-card-title">{v.label}</div>
          <div className="body muted">{timeAgo(now - report.createdAt)}</div>
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
            <Icon name="check" /> {t('report.card.confirm')}
          </button>
          <button className="btn" data-active={voted === false} disabled={!canVote || sending} onClick={() => onVote(false)}>
            <Icon name="close" /> {t('report.card.gone')}
          </button>
        </div>
      )}
    </section>
  );
}
