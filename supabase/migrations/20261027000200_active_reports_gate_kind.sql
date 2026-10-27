-- Az active_reports nézet újra: a `select *` az init-migrációban a nézet létrehozásakor rögzítette
-- az oszloplistát, így a később felvett gate_kind / road / speed_limit_kmh hiányzott belőle
-- (az app lekérése 400-at kapott). Explicit oszloplistával hozzuk létre, hogy ez ne ismétlődjön:
-- új oszlopnál ezt a nézetet is bővíteni kell.
drop view if exists public.active_reports;

create view public.active_reports
with (security_invoker = true) as
  select id, type, lat, lon, heading_deg, section_id, user_id, created_at,
         confirmations, denials, expires_at, gate_kind, road, speed_limit_kmh
    from public.reports
   where expires_at > now();

grant select on public.active_reports to anon, authenticated;
