import { NAV_CONFIG, SearchController, t, type Place, type SavedPlaces, type SearchState } from '@atlagsebesseg/app-logic';
import { useEffect, useRef, useState } from 'react';
import type { SearchFor } from '../nav/useNavigation';
import { Icon, type IconName } from './Icon';

function PlaceRow({ icon, name, address, onClick }: { icon: IconName; name: string; address: string; onClick: () => void }) {
  return (
    <button className="place-row" onClick={onClick}>
      <span className="place-icon">
        <Icon name={icon} size={22} />
      </span>
      <span className="place-text">
        <b>{name}</b>
        {address && <span>{address}</span>}
      </span>
    </button>
  );
}

/**
 * Teljes képernyős kereső: gépelés közben találatok (3 karaktertől, 300 ms késleltetéssel), alatta a
 * mentett helyek (Haza / Munka) és az utolsó úti célok. Koppintásra a hely a célpont.
 */
export function SearchScreen({
  kind,
  recents,
  saved,
  search,
  onPick,
  onClose,
}: {
  kind: SearchFor;
  recents: readonly Place[];
  saved: SavedPlaces;
  search: (query: string) => Promise<Place[]>;
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
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const title = kind === 'home' ? t('nav.search.pickHome') : kind === 'work' ? t('nav.search.pickWork') : null;
  const idle = state.status === 'idle';
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
      <div className="search-body">
        {state.status === 'loading' && <div className="search-note">{t('nav.search.loading')}</div>}
        {state.status === 'error' && <div className="search-note" data-tone="tul">{t('nav.search.error')}</div>}
        {state.status === 'ok' && state.places.length === 0 && <div className="search-note">{t('nav.search.empty')}</div>}
        {state.status === 'ok' && state.places.map((p) => <PlaceRow key={p.id} icon="pin" name={p.name} address={p.address} onClick={() => onPick(p)} />)}
        {idle && (
          <>
            {query.trim().length > 0 && query.trim().length < NAV_CONFIG.geocodeMinChars && (
              <div className="search-note">{t('nav.search.hint', { n: NAV_CONFIG.geocodeMinChars })}</div>
            )}
            {kind === 'dest' && (saved.home || saved.work) && (
              <div className="search-saved">
                {saved.home && <PlaceRow icon="home" name={t('nav.place.home')} address={saved.home.name} onClick={() => onPick(saved.home!)} />}
                {saved.work && <PlaceRow icon="work" name={t('nav.place.work')} address={saved.work.name} onClick={() => onPick(saved.work!)} />}
              </div>
            )}
            <div className="group-label">{t('nav.search.recent')}</div>
            {recents.length === 0 && <div className="search-note">{t('nav.search.noRecent')}</div>}
            {recents.map((p) => (
              <PlaceRow key={p.id} icon="pin" name={p.name} address={p.address} onClick={() => onPick(p)} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
