-- =====================================================================
-- Staff-Solutions - Migration 009: Berechtigungsprofile
--
-- Die Daten sind in Stufen geteilt. Pro Firma und Rolle wird festgelegt,
-- welche Stufen jemand sieht und für welche Standorte:
--   Verzeichnis     Name, Funktion, Arbeitsort, Dienstantritt (sehen alle mit Zugang)
--   Kontakt         Telefon, E-Mail
--   Personendaten   Adresse, Geburtsdatum, Stunden, Befristung
--   Entgelt         Netto, Brutto, Zulagen
--   Lohnverrechnung Versicherungsnummer, IBAN, Staatsangehörigkeit
--   Dokumente       Verträge und Vereinbarungen
-- Reichweite: alle Standorte, nur zugeordnete Standorte, nur eigene Daten.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Neue Rollen
-- ---------------------------------------------------------------------
alter table public.profil drop constraint profil_rolle_check;
alter table public.profil add constraint profil_rolle_check check (rolle in (
  'admin', 'geschaeftsfuehrung', 'hr', 'verwaltung', 'buchhaltung',
  'regionalleitung', 'studioleitung', 'mitarbeiter'
));

-- ---------------------------------------------------------------------
-- 2. Rechte je Firma und Rolle
-- ---------------------------------------------------------------------
create table public.rollen_recht (
  organisation_id      uuid not null references public.organisation(id) on delete cascade,
  rolle                text not null,
  bezeichnung          text not null,
  sieht_kontakt        boolean not null default false,
  sieht_personendaten  boolean not null default false,
  sieht_entgelt        boolean not null default false,
  sieht_lohnverrechnung boolean not null default false,
  sieht_dokumente      boolean not null default false,
  reichweite           text not null default 'eigene'
                       check (reichweite in ('alle', 'zugeordnet', 'eigene')),
  darf_anlegen         boolean not null default false,
  darf_verwalten       boolean not null default false,   -- Einstellungen und Rechte ändern
  primary key (organisation_id, rolle),
  check (rolle in ('admin', 'geschaeftsfuehrung', 'hr', 'verwaltung', 'buchhaltung',
                   'regionalleitung', 'studioleitung', 'mitarbeiter'))
);

-- Standardwerte für eine neue Firma (nach den Vorgaben von Mansur, 16.11.2026)
create or replace function app.standard_rechte(org uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.rollen_recht (organisation_id, rolle, bezeichnung, sieht_kontakt, sieht_personendaten,
    sieht_entgelt, sieht_lohnverrechnung, sieht_dokumente, reichweite, darf_anlegen, darf_verwalten)
  values
    (org, 'admin',              'Admin',             true,  true,  true,  true,  true,  'alle',       true,  true),
    (org, 'geschaeftsfuehrung', 'Geschäftsführung',  true,  true,  true,  true,  true,  'alle',       true,  false),
    (org, 'hr',                 'Personalbüro',      true,  true,  true,  true,  true,  'alle',       true,  false),
    (org, 'verwaltung',         'Verwaltung',        true,  false, false, false, false, 'alle',       false, false),
    (org, 'buchhaltung',        'Buchhaltung',       true,  true,  true,  true,  false, 'alle',       false, false),
    (org, 'regionalleitung',    'Regionalleitung',   true,  true,  true,  false, true,  'zugeordnet', true,  false),
    (org, 'studioleitung',      'Studioleitung',     true,  false, false, false, true,  'zugeordnet', true,  false),
    (org, 'mitarbeiter',        'Mitarbeiter',       false, false, false, false, false, 'eigene',     false, false)
  on conflict (organisation_id, rolle) do nothing
$$;

create or replace function app.neue_organisation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.standard_rechte(new.id);
  return new;
end $$;

create trigger standard_rechte after insert on public.organisation
  for each row execute function app.neue_organisation();

select app.standard_rechte(id) from public.organisation;

-- ---------------------------------------------------------------------
-- 3. Hilfsfunktionen für die Zugriffsregeln
-- ---------------------------------------------------------------------

-- Darf die angemeldete Person die Stufe "bereich" für diesen Standort sehen?
create or replace function app.sieht(bereich text, standort uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case bereich
             when 'kontakt'         then r.sieht_kontakt
             when 'personendaten'   then r.sieht_personendaten
             when 'entgelt'         then r.sieht_entgelt
             when 'lohnverrechnung' then r.sieht_lohnverrechnung
             when 'dokumente'       then r.sieht_dokumente
             else false end
       and case r.reichweite
             when 'alle'       then true
             when 'zugeordnet' then exists (select 1 from public.zustaendigkeit z
                                            where z.user_id = p.user_id and z.standort_id = standort)
             else false end
    from public.profil p
    join public.rollen_recht r on r.organisation_id = p.organisation_id and r.rolle = p.rolle
    where p.user_id = (select auth.uid())
  ), false)
$$;

-- Standort eines Dienstverhältnisses (für Regeln auf Entgelt, Zulagen, Dokumente)
create or replace function app.standort_von(dv uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select d.heimstandort_id from public.dienstverhaeltnis d where d.id = dv
$$;

-- Sieht die Person die Stufe für irgendein Dienstverhältnis dieses Mitarbeiters?
create or replace function app.sieht_person(bereich text, ma uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.dienstverhaeltnis d
                 where d.mitarbeiter_id = ma and app.sieht(bereich, d.heimstandort_id))
$$;

revoke execute on function app.sieht(text, uuid), app.standort_von(uuid), app.sieht_person(text, uuid),
  app.standard_rechte(uuid) from public, anon;
grant execute on function app.sieht(text, uuid), app.standort_von(uuid), app.sieht_person(text, uuid)
  to authenticated;
revoke execute on function app.neue_organisation() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Zugriffsregeln nach Rechten (ersetzen die bisherigen Leitungs-Regeln)
--    Schreiben bleibt beim Büro (admin, geschaeftsfuehrung, hr).
-- ---------------------------------------------------------------------
drop policy leitung_dienstverhaeltnis on public.dienstverhaeltnis;
drop policy leitung_mitarbeiter on public.mitarbeiter;
drop policy leitung_dokumente on public.dokument;

create policy nach_recht on public.dienstverhaeltnis for select to authenticated
  using (organisation_id = (select app.organisation_id()) and app.sieht('personendaten', heimstandort_id));

create policy nach_recht on public.mitarbeiter for select to authenticated
  using (organisation_id = (select app.organisation_id()) and app.sieht_person('personendaten', id));

create policy nach_recht on public.entgelt for select to authenticated
  using (organisation_id = (select app.organisation_id())
         and app.sieht('entgelt', app.standort_von(dienstverhaeltnis_id)));

create policy nach_recht on public.zulage for select to authenticated
  using (organisation_id = (select app.organisation_id())
         and app.sieht('entgelt', app.standort_von(dienstverhaeltnis_id)));

create policy nach_recht on public.mitarbeiter_sensibel for select to authenticated
  using (organisation_id = (select app.organisation_id()) and app.sieht_person('lohnverrechnung', mitarbeiter_id));

create policy nach_recht on public.dokument for select to authenticated
  using (organisation_id = (select app.organisation_id())
         and app.sieht('dokumente', app.standort_von(dienstverhaeltnis_id)));

create policy nach_recht on public.brutto_tabelle for select to authenticated
  using (organisation_id = (select app.organisation_id())
         and exists (select 1 from public.profil p
                     join public.rollen_recht r on r.organisation_id = p.organisation_id and r.rolle = p.rolle
                     where p.user_id = (select auth.uid()) and r.sieht_entgelt));

create policy alle_lesen on public.tarifzone for select to authenticated
  using (organisation_id = (select app.organisation_id()));

-- Rechte-Tabelle: alle der Firma dürfen lesen, nur wer verwalten darf ändern.
-- Die Admin-Zeile kann niemand über die App ändern (man sperrt sich nicht selbst aus).
alter table public.rollen_recht enable row level security;
revoke all on public.rollen_recht from anon;
grant select, update on public.rollen_recht to authenticated;

create policy alle_lesen on public.rollen_recht for select to authenticated
  using (organisation_id = (select app.organisation_id()));
create policy verwalten on public.rollen_recht for update to authenticated
  using (organisation_id = (select app.organisation_id()) and rolle <> 'admin'
         and exists (select 1 from public.profil p
                     join public.rollen_recht r on r.organisation_id = p.organisation_id and r.rolle = p.rolle
                     where p.user_id = (select auth.uid()) and r.darf_verwalten))
  with check (organisation_id = (select app.organisation_id()) and rolle <> 'admin');

-- Nur wer das Recht "anlegen" hat, darf Mitarbeiter anlegen (zusätzlich zur Rollenprüfung)
create or replace function app.anlegen_pruefen() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and not coalesce((
      select r.darf_anlegen from public.profil p
      join public.rollen_recht r on r.organisation_id = p.organisation_id and r.rolle = p.rolle
      where p.user_id = (select auth.uid())), false) then
    raise exception 'Mit deinem Zugang kannst du keine Mitarbeiter anlegen.';
  end if;
  return new;
end $$;
revoke execute on function app.anlegen_pruefen() from public, anon, authenticated;

create trigger anlegen_pruefen before insert on public.mitarbeiter
  for each row execute function app.anlegen_pruefen();

-- ---------------------------------------------------------------------
-- 5. Mitarbeiterverzeichnis: eine Liste für alle Rollen.
--    Jede Spalte wird nur befüllt, wenn die Person diese Stufe sehen darf.
-- ---------------------------------------------------------------------
create or replace function public.mitarbeiter_verzeichnis()
returns table (
  dienstverhaeltnis_id uuid,
  mitarbeiter_id       uuid,
  vorname              text,
  nachname             text,
  funktion_id          uuid,
  standort_id          uuid,
  eintritt             date,
  austritt             date,
  erfasst_am           timestamptz,
  telefon              text,
  email                text,
  beschaeftigungsart   text,
  wochenstunden        numeric,
  befristet_bis        date
)
language sql stable security definer set search_path = '' as $$
  with ich as (
    select p.user_id, p.organisation_id, p.mitarbeiter_id,
           r.sieht_kontakt, r.sieht_personendaten, r.reichweite
    from public.profil p
    join public.rollen_recht r on r.organisation_id = p.organisation_id and r.rolle = p.rolle
    where p.user_id = (select auth.uid())
  )
  select d.id, m.id, m.vorname, m.nachname, d.funktion_id, d.heimstandort_id,
         d.eintritt, d.austritt, d.created_at,
         case when ich.sieht_kontakt then m.telefon end,
         case when ich.sieht_kontakt then m.email end,
         case when ich.sieht_personendaten then d.beschaeftigungsart end,
         case when ich.sieht_personendaten then d.wochenstunden end,
         case when ich.sieht_personendaten then d.befristet_bis end
  from ich
  join public.dienstverhaeltnis d on d.organisation_id = ich.organisation_id
  join public.mitarbeiter m on m.id = d.mitarbeiter_id
  where case ich.reichweite
          when 'alle' then true
          when 'zugeordnet' then exists (select 1 from public.zustaendigkeit z
                                         where z.user_id = ich.user_id and z.standort_id = d.heimstandort_id)
          else m.id = ich.mitarbeiter_id
        end
$$;

revoke execute on function public.mitarbeiter_verzeichnis() from public, anon;
grant execute on function public.mitarbeiter_verzeichnis() to authenticated;
