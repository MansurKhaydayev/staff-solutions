-- Fund aus Test 07: Ein Austrittsdatum ohne Meldung (Altbestand oder vom Betreiber eingetragen) muss
-- ebenfalls aus den aktiven Listen führen. Maßgeblich ist zuerst das Datum, dann der Status.
create or replace function app.dv_aktiv(p_dv uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when d.austritt is not null and d.austritt < app.heute_wien() then false
    else app.dv_status(p_dv) in ('aktiv', 'austritt_gemeldet', 'nicht_angetreten_gemeldet', 'austritt_bestaetigt', 'abgemeldet') end
  from public.dienstverhaeltnis d where d.id = p_dv
$$;
