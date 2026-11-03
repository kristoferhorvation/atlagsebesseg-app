-- AOS17: a „Térképhiba” (`szakasz_hiba`) bejelentés alkategóriája – additív oszlop. Régi sorban és régi kliensnél NULL;
-- más típus nem kaphat alkategóriát. A nézet explicit oszloplistájú, ezért a végére bővül (lásd 20261027000200).
alter table public.reports
  add column if not exists subtype text
  check (subtype is null or (type = 'szakasz_hiba' and subtype in ('szakaszhatar', 'sebesseghatar', 'nem_letezik', 'hianyzo', 'kamera', 'egyeb')));

create or replace view public.active_reports
with (security_invoker = true) as
  select id, type, lat, lon, heading_deg, section_id, user_id, created_at,
         confirmations, denials, expires_at, gate_kind, road, speed_limit_kmh, subtype
    from public.reports
   where expires_at > now();
