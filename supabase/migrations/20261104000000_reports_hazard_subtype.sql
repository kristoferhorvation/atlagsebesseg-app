-- AW22: a „Veszély” (`akadaly` típus, a felirat változott, az enum-érték és a meglévő sorok nem) altípusa a `reports.subtype`-ban.
-- Additív: a feltétel bővül; régi „Akadály” sor és régi kliens NULL-lal marad, adatmódosítás nincs.
alter table public.reports drop constraint if exists reports_subtype_check;
alter table public.reports add constraint reports_subtype_check check (
  subtype is null
  or (type = 'szakasz_hiba' and subtype in ('szakaszhatar', 'sebesseghatar', 'nem_letezik', 'hianyzo', 'kamera', 'egyeb'))
  or (type = 'akadaly' and subtype in ('targy', 'katyu', 'allo_jarmu'))
);
