-- AW18: új bejelentéstípusok – „Dugó” (lassan halad) és „Beállt” (áll).
-- Külön migrációban, mert az új enum-érték csak a tranzakció lezárása után használható.
alter type public.report_type add value if not exists 'dugo';
alter type public.report_type add value if not exists 'beallt';
