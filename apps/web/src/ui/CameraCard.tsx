import { CAMERA_LABEL, cameraSourceText, type FixedCamera } from '@atlagsebesseg/app-logic';
import { cameraIcon } from './cameraIcon';
import { Icon } from './Icon';

/** Koppintásra megjelenő kis kártya egy fix kamerához: típus és forrás (szavazás nincs – nem bejelentés). */
export function CameraCard({ camera, onClose }: { camera: FixedCamera; onClose: () => void }) {
  const label = CAMERA_LABEL[camera.type];
  const detail = [camera.road, camera.speedLimitKmh && `${camera.speedLimitKmh} km/h`]
    .filter(Boolean)
    .join(' · ');
  return (
    <section className="report-card camera-card glass" aria-label={`Fix kamera: ${label}`}>
      <div className="report-card-head">
        <span className="report-card-ic camera-card-ic">
          <Icon name={cameraIcon(camera.type)} size={26} />
        </span>
        <div className="report-card-text">
          <div className="report-card-title">{label}</div>
          {detail && <div className="body muted">{detail}</div>}
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Bezárás">
          <Icon name="close" size={22} />
        </button>
      </div>
      <div className="camera-card-source">
        {camera.verified && <Icon name="check" size={18} />} {cameraSourceText(camera)}
      </div>
    </section>
  );
}
