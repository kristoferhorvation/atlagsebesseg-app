-- A6 lezárás: honnan jön a sebességhatár. 'hivatalos' = a hivatalos forrás adja; 'osm' = az OSM
-- `maxspeed`-je (OSM-szakasz, vagy hivatalos szakasz, amelynek forrása nem ad határt). Közösségi
-- szakasznál üres. Csak hozzáad; az értékeket a következő feltöltés tölti ki.
alter table public.sections
  add column limit_source text check (limit_source is null or limit_source in ('hivatalos', 'osm')),
  add constraint sections_kozosseg_hatar_forras_nelkul check (source <> 'kozosseg' or limit_source is null);
