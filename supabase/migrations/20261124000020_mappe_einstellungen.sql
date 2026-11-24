-- Unterschriftsmappe, Teil 1: Fristregel für den Dienstantritt, Textbausteine für den Dienstzettel,
-- Texte der Onboarding-Unterlagen, Recht für die Arbeitgeber-Unterschrift.

-- Fristregel (Werte in den Einstellungen änderbar)
alter table public.organisation add column anmeldung_stichzeit time not null default '12:00';
alter table public.organisation add column tage_dazwischen_vor int not null default 0 check (tage_dazwischen_vor between 0 and 7);
alter table public.organisation add column tage_dazwischen_nach int not null default 1 check (tage_dazwischen_nach between 0 and 7);

-- Wiener Zeit, unabhängig von der Zeitzone des Datenbank-Servers
create or replace function app.jetzt_wien() returns timestamp
language sql stable set search_path = '' as $$ select (now() at time zone 'Europe/Vienna') $$;
create or replace function app.heute_wien() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Europe/Vienna')::date $$;

-- Frühester Dienstantritt, wenn zum Zeitpunkt p_zeitpunkt (Wiener Ortszeit) übermittelt wird
create or replace function app.fruehester_dienstantritt(p_org uuid, p_zeitpunkt timestamp) returns date
language sql stable security definer set search_path = '' as $$
  select p_zeitpunkt::date + 1 +
    case when p_zeitpunkt::time <= o.anmeldung_stichzeit then o.tage_dazwischen_vor else o.tage_dazwischen_nach end
  from public.organisation o where o.id = p_org
$$;

create or replace function app.frist_meldung(p_tag date) returns text
language sql immutable set search_path = '' as $$
  select 'Zu kurzfristig. Frühester Dienstantritt ist '
    || (array['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'])[extract(dow from p_tag)::int + 1]
    || ', ' || to_char(p_tag, 'DD.MM.YYYY')
    || '. Bei dringendem Bedarf „Dringende Anmeldung“ wählen.'
$$;

-- Textbausteine für den Dienstzettel: für die ganze Firma, je GmbH überschreibbar
create table public.textbaustein (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisation(id),
  gesellschaft_id  uuid,
  schluessel       text not null check (schluessel ~ '^[a-z_]+$'),
  titel            text not null,
  text             text not null default '',
  reihenfolge      int not null default 0,
  aktiv            boolean not null default true,
  created_at       timestamptz not null default now(),
  foreign key (gesellschaft_id, organisation_id) references public.gesellschaft (id, organisation_id)
);
create unique index textbaustein_einmal on public.textbaustein
  (organisation_id, coalesce(gesellschaft_id, '00000000-0000-0000-0000-000000000000'::uuid), schluessel);
create index on public.textbaustein (gesellschaft_id, organisation_id);
alter table public.textbaustein enable row level security;
create policy buero_lesen on public.textbaustein for select to authenticated
  using (organisation_id = (select app.organisation_id()) and (select app.ist_buero()));
create policy buero_anlegen on public.textbaustein for insert to authenticated
  with check (organisation_id = (select app.organisation_id()) and (select app.ist_buero()));
create policy buero_aendern on public.textbaustein for update to authenticated
  using (organisation_id = (select app.organisation_id()) and (select app.ist_buero()))
  with check (organisation_id = (select app.organisation_id()) and (select app.ist_buero()));
create trigger loeschen_verboten before delete on public.textbaustein
  for each row execute function app.loeschen_verboten();
create trigger audit_textbaustein after insert or update or delete on public.textbaustein
  for each row execute function app.audit();

-- Text der Onboarding-Unterlagen (wird in der Mappe angezeigt und ins PDF übernommen)
alter table public.onboarding_unterlage add column text text not null default '';

-- Wer für den Arbeitgeber unterschreiben darf
alter table public.rollen_recht add column darf_arbeitgeber_unterschreiben boolean not null default false;
update public.rollen_recht set darf_arbeitgeber_unterschreiben = true where rolle in ('admin', 'geschaeftsfuehrung');

create or replace function app.standard_rechte(org uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.rollen_recht (organisation_id, rolle, bezeichnung, sieht_kontakt, sieht_personendaten,
    sieht_entgelt, sieht_lohnverrechnung, sieht_dokumente, reichweite, darf_anlegen, darf_verwalten,
    darf_arbeitgeber_unterschreiben)
  values
    (org, 'admin',              'Admin',             true,  true,  true,  true,  true,  'alle',       true,  true,  true),
    (org, 'geschaeftsfuehrung', 'Geschäftsführung',  true,  true,  true,  true,  true,  'alle',       true,  false, true),
    (org, 'hr',                 'Personalbüro',      true,  true,  true,  true,  true,  'alle',       true,  false, false),
    (org, 'verwaltung',         'Verwaltung',        true,  false, false, false, false, 'alle',       false, false, false),
    (org, 'buchhaltung',        'Buchhaltung',       true,  true,  true,  true,  false, 'alle',       false, false, false),
    (org, 'regionalleitung',    'Regionalleitung',   true,  true,  true,  false, true,  'zugeordnet', true,  false, false),
    (org, 'studioleitung',      'Studioleitung',     true,  false, false, false, true,  'zugeordnet', true,  false, false),
    (org, 'mitarbeiter',        'Mitarbeiter',       false, false, false, false, false, 'eigene',     false, false, false)
  on conflict (organisation_id, rolle) do nothing
$$;

create or replace function app.darf_arbeitgeber_unterschreiben() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select r.darf_arbeitgeber_unterschreiben from public.profil p
    join public.rollen_recht r on r.organisation_id = p.organisation_id and r.rolle = p.rolle
    where p.user_id = (select auth.uid())), false)
$$;

revoke execute on function app.fruehester_dienstantritt(uuid, timestamp), app.darf_arbeitgeber_unterschreiben() from public, anon;
grant execute on function app.fruehester_dienstantritt(uuid, timestamp), app.darf_arbeitgeber_unterschreiben() to authenticated;
