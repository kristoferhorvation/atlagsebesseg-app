-- A6: a szakaszok forrása (hivatalos import). Ki adta ki, hol, mikor, és hogyan lett belőle hely
-- (koordináta / km-szelvény / településnév). Hivatalos szakasznál kötelező; közösségi szakasz nem
-- hivatkozhat hivatalos forrásra (a kliens ne tudjon „Polizia di Stato” feliratot írni).
alter table public.sections
  add column source_name text check (source_name is null or length(source_name) between 1 and 120),
  add column source_url  text check (source_url is null or source_url ~ '^https?://'),
  add column source_date text check (source_date is null or source_date ~ '^\d{4}-\d{2}(-\d{2})?$'),
  add column located_by  text check (located_by is null or located_by in ('koordinata', 'km_szelveny', 'telepules')),
  add constraint sections_hivatalos_forras check (
    source <> 'hivatalos'
    or (source_name is not null and source_url is not null and source_date is not null and located_by is not null)
  ),
  add constraint sections_kozosseg_forras_nelkul check (
    source <> 'kozosseg'
    or (source_name is null and source_url is null and source_date is null and located_by is null)
  );
