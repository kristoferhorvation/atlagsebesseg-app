-- ---------------------------------------------------------------------------
-- planned_checks: zóna-típusú sor (A7c)
-- Ha a rendőrségi közlemény csak települést nevez meg (út nélkül), a sor geometriája a település
-- OSM-közigazgatási határa: Polygon / MultiPolygon. Csak bővít: a vonalas sorok változatlanok.
-- speed_limit_kmh / limit_source zónánál formális érték (KRESZ lakott területi 50), a sáv nem mutatja.
-- ---------------------------------------------------------------------------
alter table public.planned_checks drop constraint planned_checks_geometry_check;
alter table public.planned_checks
  add constraint planned_checks_geometry_check
  check (geometry ->> 'type' in ('LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'));

comment on column public.planned_checks.geometry is
  'GeoJSON: LineString / MultiLineString (út, utca, kereszteződés) vagy Polygon / MultiPolygon (zóna: egész település)';
