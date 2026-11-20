-- =====================================================================
-- Staff-Solutions - Migration 010
-- Korrektur: Die Regel "verwalten" auf rollen_recht fragte rollen_recht
-- selbst ab und erzeugte eine Endlosschleife. Die Prüfung liegt jetzt in
-- einer Hilfsfunktion, die ohne erneute Regelprüfung liest.
-- =====================================================================

create or replace function app.darf_verwalten() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select r.darf_verwalten from public.profil p
    join public.rollen_recht r on r.organisation_id = p.organisation_id and r.rolle = p.rolle
    where p.user_id = (select auth.uid())), false)
$$;

create or replace function app.sieht_entgelt_irgendwo() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select r.sieht_entgelt from public.profil p
    join public.rollen_recht r on r.organisation_id = p.organisation_id and r.rolle = p.rolle
    where p.user_id = (select auth.uid())), false)
$$;

revoke execute on function app.darf_verwalten(), app.sieht_entgelt_irgendwo() from public, anon;
grant  execute on function app.darf_verwalten(), app.sieht_entgelt_irgendwo() to authenticated;

drop policy verwalten on public.rollen_recht;
create policy verwalten on public.rollen_recht for update to authenticated
  using (organisation_id = (select app.organisation_id()) and rolle <> 'admin' and (select app.darf_verwalten()))
  with check (organisation_id = (select app.organisation_id()) and rolle <> 'admin');

drop policy nach_recht on public.brutto_tabelle;
create policy nach_recht on public.brutto_tabelle for select to authenticated
  using (organisation_id = (select app.organisation_id()) and (select app.sieht_entgelt_irgendwo()));
