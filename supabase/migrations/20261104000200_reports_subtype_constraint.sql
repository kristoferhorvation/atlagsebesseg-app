-- AW22: az AOS17-es alkategória-feltétel generált neve `reports_check1` volt, így az előző migráció mellette maradt és a Veszély altípusát tiltotta.
-- Csak a régi feltétel esik ki (név szerint nem biztos, ezért a definíciója alapján); `reports_subtype_check` marad. Adat nem változik.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.reports'::regclass and contype = 'c' and conname <> 'reports_subtype_check' and pg_get_constraintdef(oid) like '%subtype%'
  loop
    execute format('alter table public.reports drop constraint %I', c.conname);
  end loop;
end $$;
