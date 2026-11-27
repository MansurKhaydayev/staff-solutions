-- Austritt, Storno und Mail-Knöpfe, Teil 1: Grundlage.
-- Meldungen (Austritt / nicht angetreten) in eigener Tabelle, nie gelöscht, nur über Funktionen.
-- Der Status eines Dienstverhältnisses wird berechnet, nicht gespeichert.

-- 1. Einstellungen je Firma
alter table public.organisation add column abmeldefrist_tage int not null default 7
  check (abmeldefrist_tage between 1 and 30);
alter table public.organisation add column buero_email text;

create table public.austrittsart (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisation(id),
  schluessel       text not null check (schluessel ~ '^[a-z_]+$'),
  bezeichnung      text not null check (trim(bezeichnung) <> ''),
  reihenfolge      int not null default 0,
  aktiv            boolean not null default true,
  unique (organisation_id, schluessel)
);
alter table public.austrittsart enable row level security;
create policy alle_lesen on public.austrittsart for select to authenticated
  using (organisation_id = (select app.organisation_id()));
create policy buero_anlegen on public.austrittsart for insert to authenticated
  with check (organisation_id = (select app.organisation_id()) and (select app.ist_buero()));
create policy buero_aendern on public.austrittsart for update to authenticated
  using (organisation_id = (select app.organisation_id()) and (select app.ist_buero()))
  with check (organisation_id = (select app.organisation_id()) and (select app.ist_buero()));
create trigger loeschen_verboten before delete on public.austrittsart
  for each row execute function app.loeschen_verboten();
create trigger audit_austrittsart after insert or update or delete on public.austrittsart
  for each row execute function app.audit();
grant select, insert, update on public.austrittsart to authenticated;

create or replace function app.standard_austrittsarten(org uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.austrittsart (organisation_id, schluessel, bezeichnung, reihenfolge)
  select org, s, b, r from (values
    ('probezeit', 'Lösung in der Probezeit', 1),
    ('kuendigung_an', 'Kündigung durch Arbeitnehmer', 2),
    ('kuendigung_ag', 'Kündigung durch Arbeitgeber', 3),
    ('einvernehmlich', 'Einvernehmliche Auflösung', 4),
    ('befristung', 'Ende der Befristung', 5),
    ('entlassung', 'Entlassung', 6),
    ('vorzeitig', 'Vorzeitiger Austritt', 7),
    ('sonstiges', 'Sonstiges', 8)) v(s, b, r)
  on conflict (organisation_id, schluessel) do nothing
$$;
create or replace function app.neue_organisation_austritt() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.standard_austrittsarten(new.id);
  return new;
end $$;
create trigger standard_austrittsarten after insert on public.organisation
  for each row execute function app.neue_organisation_austritt();
select app.standard_austrittsarten(id) from public.organisation;

-- 2. Meldungen
create table public.austritt_meldung (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisation(id),
  dienstverhaeltnis_id uuid not null,
  art                  text not null check (art in ('austritt', 'nicht_angetreten')),
  letzter_arbeitstag   date,
  austrittsart         text,
  notiz                text,
  gemeldet_von         uuid references auth.users(id),
  gemeldet_am          timestamptz not null default now(),
  bestaetigt_von       uuid references auth.users(id),
  bestaetigt_am        timestamptz,
  abweichung           text,
  zurueckgenommen      boolean not null default false,
  korrektur_grund      text,
  ersetzt_durch        uuid references public.austritt_meldung(id),
  ersetzt_am           timestamptz,
  unique (id, organisation_id),
  foreign key (dienstverhaeltnis_id, organisation_id) references public.dienstverhaeltnis (id, organisation_id),
  check (art <> 'austritt' or zurueckgenommen or (letzter_arbeitstag is not null and austrittsart is not null)),
  check (art <> 'nicht_angetreten' or zurueckgenommen or nullif(trim(notiz), '') is not null),
  check ((bestaetigt_am is null) = (bestaetigt_von is null)),
  check ((ersetzt_durch is null) = (ersetzt_am is null))
);
-- höchstens eine gültige Meldung je Dienstverhältnis
create unique index austritt_meldung_eine_gueltige on public.austritt_meldung (dienstverhaeltnis_id) where ersetzt_durch is null;
create index on public.austritt_meldung (organisation_id);
create index on public.austritt_meldung (gemeldet_von);
create index on public.austritt_meldung (bestaetigt_von);
create index on public.austritt_meldung (ersetzt_durch);

alter table public.austritt_meldung enable row level security;
create policy nach_recht on public.austritt_meldung for select to authenticated
  using (organisation_id = (select app.organisation_id()) and app.in_reichweite(dienstverhaeltnis_id));
grant select on public.austritt_meldung to authenticated;
create trigger nur_ueber_funktionen before insert or update on public.austritt_meldung
  for each row execute function app.nur_ueber_funktionen();
create trigger loeschen_verboten before delete on public.austritt_meldung
  for each row execute function app.loeschen_verboten();
create trigger audit_austritt_meldung after insert or update or delete on public.austritt_meldung
  for each row execute function app.audit();

-- 3. Dokumente: Kategorie „storno“, Typen der erzeugten Meldungen, Bezug zur Meldung
alter table public.dokument drop constraint dokument_kategorie_check;
alter table public.dokument add constraint dokument_kategorie_check check (kategorie in (
  'anmeldung', 'onboarding', 'vereinbarung', 'abmeldung', 'storno',
  'nachweis_personendaten', 'nachweis_lohnverrechnung', 'sonstiges'));
alter table public.dokument drop constraint dokument_typ_check;
alter table public.dokument add constraint dokument_typ_check check (typ in (
  'probearbeit', 'dienstzettel', 'dienstvertrag', 'einzelvereinbarung',
  'einwilligung_wechsel', 'mitteilung_unbefristet', 'onboarding',
  'anmeldebestaetigung', 'sonstiges', 'austrittsmeldung', 'stornomeldung', 'korrekturmeldung'));
alter table public.dokument add column austritt_meldung_id uuid references public.austritt_meldung(id);
create index on public.dokument (austritt_meldung_id);

create or replace function app.zusatzstufe(p_kategorie text) returns text
language sql immutable set search_path = '' as $$
  select case p_kategorie
    when 'vereinbarung' then 'entgelt'
    when 'unterschrift' then 'entgelt'
    when 'anmeldung' then 'lohnverrechnung'
    when 'abmeldung' then 'lohnverrechnung'
    when 'storno' then 'lohnverrechnung'
    when 'nachweis_lohnverrechnung' then 'lohnverrechnung'
    when 'nachweis_personendaten' then 'personendaten'
    else null end
$$;

-- 4. Austrittsdatum nur über die Funktionen
create or replace function app.austritt_schuetzen() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and new.austritt is distinct from old.austritt then
    raise exception 'Der Austritt ändert sich nur über „Austritt melden“ und die Bestätigung des Büros.';
  end if;
  return new;
end $$;
create trigger austritt_schuetzen before update on public.dienstverhaeltnis
  for each row execute function app.austritt_schuetzen();

-- 5. Status
create or replace function app.aktuelle_meldung(p_dv uuid) returns public.austritt_meldung
language sql stable security definer set search_path = '' as $$
  select m.* from public.austritt_meldung m
  where m.dienstverhaeltnis_id = p_dv and m.ersetzt_durch is null and not m.zurueckgenommen
$$;

-- hochgeladene Bestätigung (nicht das selbst erzeugte Meldungs-PDF)
create or replace function app.bestaetigung_liegt_vor(p_dv uuid, p_kategorie text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.dokument x where x.dienstverhaeltnis_id = p_dv and x.kategorie = p_kategorie
                 and x.datei_pfad is not null and x.ersetzt_durch is null
                 and x.typ not in ('austrittsmeldung', 'stornomeldung', 'korrekturmeldung'))
$$;

create or replace function app.dv_status(p_dv uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  m public.austritt_meldung;
begin
  m := app.aktuelle_meldung(p_dv);
  if m.id is null then return 'aktiv'; end if;
  if m.art = 'austritt' then
    if m.bestaetigt_am is null then return 'austritt_gemeldet'; end if;
    if app.bestaetigung_liegt_vor(p_dv, 'abmeldung') then return 'abgemeldet'; end if;
    return 'austritt_bestaetigt';
  end if;
  if m.bestaetigt_am is null then return 'nicht_angetreten_gemeldet'; end if;
  -- angemeldet: wie app.angemeldet, aber unabhängig von der aufrufenden Person (auch für die Edge Function)
  if app.bestaetigung_liegt_vor(p_dv, 'anmeldung') and not app.bestaetigung_liegt_vor(p_dv, 'storno') then
    return 'storno_ausstaendig';
  end if;
  return 'nicht_angetreten';
end $$;

-- In aktiven Listen, Mappe und offenen Punkten?
create or replace function app.dv_aktiv(p_dv uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case app.dv_status(p_dv)
    when 'aktiv' then true
    when 'austritt_gemeldet' then true
    when 'nicht_angetreten_gemeldet' then true
    when 'austritt_bestaetigt' then coalesce(d.austritt >= app.heute_wien(), true)
    when 'abgemeldet' then coalesce(d.austritt >= app.heute_wien(), true)
    else false end
  from public.dienstverhaeltnis d where d.id = p_dv
$$;

revoke execute on function app.standard_austrittsarten(uuid), app.neue_organisation_austritt(), app.austritt_schuetzen()
  from public, anon, authenticated;
-- aktuelle_meldung liefert auch Notiz/Grund: nur intern
revoke execute on function app.aktuelle_meldung(uuid), app.bestaetigung_liegt_vor(uuid, text) from public, anon, authenticated;
revoke execute on function app.dv_status(uuid), app.dv_aktiv(uuid) from public, anon;
grant execute on function app.dv_status(uuid), app.dv_aktiv(uuid) to authenticated, service_role;
