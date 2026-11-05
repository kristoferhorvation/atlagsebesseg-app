import { formatDistance, localMatches, NAV_CONFIG, savedChips, SearchController, t, type Place, type SavedPlaces, type SearchState, type Settings } from '@atlagsebesseg/app-logic';
import { useEffect, useRef, useState } from 'react';
import type { SearchFor } from '../nav/useNavigation';
import { Icon, type IconName } from './Icon';

function PlaceRow({ icon, name, address, distance, onClick }: { icon: IconName; name: string; address: string; distance?: string; onClick: () => void }) {
  return (
    <button className="place-row" onClick={onClick}>
      <span className="place-icon">
        <Icon name={icon} size={22} />
      </span>
      <span className="place-text">
        <b>{name}</b>
        {address && <span>{address}</span>}
      </span>
      {distance && <span className="place-dist num">{distance}</span>}
    </button>
  );
}

/**
 * Teljes képernyős kereső: a mező alatt a mentett címek vékony chip-sora (Haza, Munka, továbbiak), alatta gépelés
 * közben a találatok (3 karaktertől, 300 ms késleltetéssel; AW23: Search Box, név + rövid cím + távolság, fölöttük a gépelt szöveggel
 * egyező mentett és korábbi helyek, API-hívás nélkül), üres mezőnél az utolsó úti célok. Koppintásra a hely a célpont.
 */
export function SearchScreen({
  kind,
  recents,
  saved,
  search,
  resolve,
  unit,
  onPick,
  onClose,
}: {
  kind: SearchFor;
  recents: readonly Place[];
  saved: SavedPlaces;
  search: (query: string) => Promise<Place[]>;
  /** A találat koordinátája választáskor (`/retrieve`). */
  resolve: (hit: Place) => Promise<Place>;
  unit: Settings['egyseg'];
  onPick: (p: Place) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ status: 'idle' });
  const searchRef = useRef(search);
  searchRef.current = search;
  const ctl = useRef<SearchController | null>(null);
  ctl.current ??= new SearchController({ search: (q) => searchRef.current(q), onState: setState });
  useEffect(() => () => ctl.current?.dispose(), []);
  useEffect(() => {
    // elsőként (capture) kapja: a Beállítások fölött nyitva (AW15) az Escape csak a keresőt zárja, a lapot nem
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const title = kind === 'home' ? t('nav.search.pickHome') : kind === 'work' ? t('nav.search.pickWork') : kind === 'other' ? t('nav.search.pickOther') : null;
  const idle = state.status === 'idle';
  const local = localMatches(query, saved, recents);
  const pick = (hit: Place) => {
    setState({ status: 'loading' });
    resolve(hit).then(onPick, () => setState({ status: 'error' }));
  };
  const distText = (p: Place) => {
    if (p.distanceM === undefined) return undefined;
    const d = formatDistance(p.distanceM, unit);
    return `${d.value} ${d.unit}`;
  };
  const chips = kind === 'dest' ? savedChips(saved) : [];
  return (
    <div className="search-screen" role="dialog" aria-modal="true" aria-label={title ?? t('map.search')}>
      <div className="search-head">
        <div className="search-field">
          <Icon name="search" size={22} />
          <input
            autoFocus
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={title ?? t('nav.search.placeholder')}
            aria-label={title ?? t('nav.search.placeholder')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              ctl.current!.input(e.target.value);
            }}
          />
        </div>
        <button className="icon-btn search-close" onClick={onClose} aria-label={t('common.close')}>
          <Icon name="close" size={20} />
        </button>
      </div>
      {chips.length > 0 && (
        <div className="saved-chips" role="list" aria-label={t('nav.search.saved')}>
          {chips.map((c) => (
            <button key={c.key} role="listitem" className="saved-chip" onClick={() => onPick(c.place)} aria-label={c.place.address ? `${c.label}, ${c.place.address}` : c.label}>
              <Icon name={c.icon} size={16} />
              <span>{c.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="search-body">
        {local.map((p) => (
          <PlaceRow key={`local-${p.id}`} icon="pin" name={p.name} address={p.address} onClick={() => onPick(p)} />
        ))}
        {state.status === 'loading' && <div className="search-note">{t('nav.search.loading')}</div>}
        {state.status === 'error' && <div className="search-note" data-tone="tul">{t('nav.search.error')}</div>}
        {state.status === 'ok' && state.places.length === 0 && local.length === 0 && <div className="search-note">{t('nav.search.empty')}</div>}
        {state.status === 'ok' && state.places.filter((p) => !local.some((l) => l.id === p.id)).map((p) => <PlaceRow key={p.id} icon="pin" name={p.name} address={p.address} distance={distText(p)} onClick={() => pick(p)} />)}
        {idle && (
          <>
            {query.trim().length > 0 && query.trim().length < NAV_CONFIG.geocodeMinChars && (
              <div className="search-note">{t('nav.search.hint', { n: NAV_CONFIG.geocodeMinChars })}</div>
            )}
            {query.trim().length === 0 && (
              <>
                <div className="group-label">{t('nav.search.recent')}</div>
                {recents.length === 0 && <div className="search-note">{t('nav.search.noRecent')}</div>}
                {recents.map((p) => (
                  <PlaceRow key={p.id} icon="pin" name={p.name} address={p.address} onClick={() => onPick(p)} />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
