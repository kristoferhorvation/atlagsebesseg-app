-- Új bejelentéstípus: ideiglenes szakaszellenőrzés kapuja (kezdő/záró).
-- Külön migrációban, mert az új enum-érték csak a tranzakció lezárása után használható.
alter type public.report_type add value if not exists 'ideiglenes_kapu';

create type public.gate_kind as enum ('kezdo', 'zaro');
