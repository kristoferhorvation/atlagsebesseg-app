import { cameraCardDetail, cameraCardMeta, cameraLabel, cameraSourceText, t, type FixedCamera, type SpeedUnit } from '@atlagsebesseg/app-logic';
import type { GpsFix } from '@atlagsebesseg/core';
import { cameraIcon } from './cameraIcon';
import { Icon } from './Icon';

/**
 * Koppintásra megjelenő kis kártya egy fix kamerához: típus, út és limit, irány a haladásunkhoz képest és távolság
 * (AOS15), forrás (szavazás nincs – nem bejelentés).
 */
export function CameraCard({ camera, fix, unit, onClose }: { camera: FixedCamera; fix: GpsFix | null; unit: SpeedUnit; onClose: () => void }) {
  const label = cameraLabel(camera.type);
  const detail = cameraCardDetail(camera, unit);
  return (
    <section className="report-card camera-card glass" aria-label={t('camera.aria', { label })}>
      <div className="report-card-head">
        <span className="report-card-ic camera-card-ic">
          <Icon name={cameraIcon(camera.type)} size={26} />
        </span>
        <div className="report-card-text">
          <div className="report-card-title">{label}</div>
          {detail && <div className="body muted">{detail}</div>}
        </div>
        <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
          <Icon name="close" size={22} />
        </button>
      </div>
      <div className="camera-card-meta">{cameraCardMeta(camera, fix, unit)}</div>
      <div className="camera-card-source">
        {camera.verified && <Icon name="check" size={18} />} {cameraSourceText(camera)}
      </div>
    </section>
  );
}
