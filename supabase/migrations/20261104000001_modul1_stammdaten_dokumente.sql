-- =====================================================================
-- Staff-Solutions - Migration 001
-- Modul 1: Mandanten, Stammdaten, Entgelt, Vorlagen, Dokumente, Protokoll
-- NUR TESTDATEN VERWENDEN.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Privates Schema für Hilfsfunktionen (wird nicht über die API veröffentlicht)
-- ---------------------------------------------------------------------
create schema if not exists app;
revoke all on schema app from public, anon;
grant usage on schema app to authenticated;

-- ---------------------------------------------------------------------
-- 1. TABELLEN
-- Jede Tabelle hat organisation_id. Verknüpfungen prüfen über
-- (id, organisation_id), dass beide Datensätze zum SELBEN Mandanten gehören.
-- ---------------------------------------------------------------------

create table public.organisation (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  probezeit_monate   int  not null default 1 check (probezeit_monate between 0 and 12),
  befristung_monate  int  not null default 3 check (befristung_monate between 0 and 24),
  created_at         timestamptz not null default now()
);

create table public.tarifzone (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisation(id),
  name             text not null,
  unique (organisation_id, name),
  unique (id, organisation_id)
);

create table public.gesellschaft (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisation(id),
  name             text not null,
  strasse          text,
  plz              text,
  ort              text,
  unique (organisation_id, name),
  unique (id, organisation_id)
);

create table public.standort (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisation(id),
  gesellschaft_id  uuid not null,
  tarifzone_id     uuid not null,
  name             text not null,
  unique (organisation_id, name),
  unique (id, organisation_id),
  unique (id, gesellschaft_id),
  foreign key (gesellschaft_id, organisation_id) references public.gesellschaft (id, organisation_id),
  foreign key (tarifzone_id, organisation_id)    references public.tarifzone (id, organisation_id)
);

create table public.funktion (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisation(id),
  name             text not null,
  unique (organisation_id, name),
  unique (id, organisation_id)
);

create table public.mitarbeiter (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisation(id),
  vorname          text not null,
  nachname         text not null,
  geburtsdatum     date,
  strasse          text,
  plz              text,
  ort              text,
  email            text,
  created_at       timestamptz not null default now(),
  unique (id, organisation_id)
);

create table public.profil (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  organisation_id  uuid not null references public.organisation(id),
  rolle            text not null check (rolle in ('admin', 'hr', 'mitarbeiter')),
  mitarbeiter_id   uuid,
  foreign key (mitarbeiter_id, organisation_id) references public.mitarbeiter (id, organisation_id)
);

create table public.dienstverhaeltnis (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisation(id),
  mitarbeiter_id     uuid not null,
  gesellschaft_id    uuid not null,
  heimstandort_id    uuid not null,
  funktion_id        uuid not null,
  beschaeftigungsart text not null
                     check (beschaeftigungsart in ('vollzeit', 'teilzeit', 'geringfuegig')),
  wochenstunden      numeric(4,1) not null check (wochenstunden > 0 and wochenstunden <= 60),
  eintritt           date not null,
  befristet_bis      date,
  austritt           date,
  created_at         timestamptz not null default now(),
  unique (id, organisation_id),
  check (austritt is null or austritt >= eintritt),
  check (befristet_bis is null or befristet_bis >= eintritt),
  foreign key (mitarbeiter_id, organisation_id)  references public.mitarbeiter (id, organisation_id),
  foreign key (gesellschaft_id, organisation_id) references public.gesellschaft (id, organisation_id),
  foreign key (funktion_id, organisation_id)     references public.funktion (id, organisation_id),
  -- Heimstudio muss zur GmbH gehören:
  foreign key (heimstandort_id, gesellschaft_id) references public.standort (id, gesellschaft_id)
);

create table public.entgelt (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisation(id),
  dienstverhaeltnis_id uuid not null,
  netto                numeric(10,2) not null check (netto >= 0),
  brutto               numeric(10,2) not null check (brutto >= 0),
  quelle               text not null check (quelle in ('tabelle', 'manuell')),
  gueltig_ab           date not null,
  created_at           timestamptz not null default now(),
  created_by           uuid references auth.users(id) default auth.uid(),
  unique (dienstverhaeltnis_id, gueltig_ab),
  foreign key (dienstverhaeltnis_id, organisation_id) references public.dienstverhaeltnis (id, organisation_id)
);

create table public.brutto_tabelle (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisation(id),
  tarifzone_id     uuid not null,
  netto            numeric(10,2) not null check (netto >= 0),
  brutto           numeric(10,2) not null check (brutto >= 0),
  gueltig_ab       date not null,
  unique (organisation_id, tarifzone_id, netto, gueltig_ab),
  foreign key (tarifzone_id, organisation_id) references public.tarifzone (id, organisation_id)
);

create table public.vorlage (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisation(id),
  funktion_id      uuid,
  typ              text not null default 'dienstzettel'
                   check (typ in ('dienstzettel', 'einwilligung_wechsel',
                                  'mitteilung_unbefristet', 'sonstiges')),
  name             text not null,
  datei_pfad       text,
  platzhalter      jsonb not null default '[]'::jsonb,
  aktiv            boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (id, organisation_id),
  foreign key (funktion_id, organisation_id) references public.funktion (id, organisation_id)
);

-- Status: entwurf -> zur_unterschrift -> unterschrieben ("wird geprüft") -> abgeschlossen
create table public.dokument (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisation(id),
  dienstverhaeltnis_id uuid not null,
  vorlage_id           uuid,
  typ                  text not null
                       check (typ in ('dienstzettel', 'einwilligung_wechsel',
                                      'mitteilung_unbefristet', 'sonstiges')),
  status               text not null default 'entwurf'
                       check (status in ('entwurf', 'zur_unterschrift',
                                         'unterschrieben', 'abgeschlossen')),
  datei_pfad           text,
  datei_hash           text,
  unterschrieben_am    timestamptz,
  unterschrieben_von   uuid references auth.users(id),
  gegengezeichnet_am   timestamptz,
  gegengezeichnet_von  uuid references auth.users(id),
  created_at           timestamptz not null default now(),
  created_by           uuid references auth.users(id) default auth.uid(),
  foreign key (dienstverhaeltnis_id, organisation_id) references public.dienstverhaeltnis (id, organisation_id),
  foreign key (vorlage_id, organisation_id)           references public.vorlage (id, organisation_id)
);

create table public.audit_log (
  id               bigint generated always as identity primary key,
  organisation_id  uuid not null,
  user_id          uuid,
  tabelle          text not null,
  datensatz_id     uuid,
  aktion           text not null,
  alt              jsonb,
  neu              jsonb,
  zeitpunkt        timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. INDIZES (für Fremdschlüssel und Zugriffsregeln)
-- ---------------------------------------------------------------------
create index on public.tarifzone (organisation_id);
create index on public.gesellschaft (organisation_id);
create index on public.standort (organisation_id);
create index on public.standort (gesellschaft_id);
create index on public.standort (tarifzone_id);
create index on public.funktion (organisation_id);
create index on public.mitarbeiter (organisation_id);
create index on public.profil (organisation_id);
create index on public.profil (mitarbeiter_id);
create index on public.dienstverhaeltnis (organisation_id);
create index on public.dienstverhaeltnis (mitarbeiter_id);
create index on public.dienstverhaeltnis (gesellschaft_id);
create index on public.dienstverhaeltnis (heimstandort_id);
create index on public.dienstverhaeltnis (funktion_id);
create index on public.dienstverhaeltnis (befristet_bis) where befristet_bis is not null;
create index on public.entgelt (organisation_id);
create index on public.brutto_tabelle (organisation_id);
create index on public.brutto_tabelle (tarifzone_id, netto, gueltig_ab desc);
create index on public.vorlage (organisation_id);
create index on public.vorlage (funktion_id);
create index on public.dokument (organisation_id);
create index on public.dokument (dienstverhaeltnis_id);
create index on public.dokument (vorlage_id);
create index on public.dokument (organisation_id, status);
create index on public.audit_log (organisation_id, zeitpunkt desc);

-- ---------------------------------------------------------------------
-- 3. HILFSFUNKTIONEN (lesen das eigene Profil des eingeloggten Benutzers)
-- ---------------------------------------------------------------------
create or replace function app.organisation_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.organisation_id from public.profil p where p.user_id = (select auth.uid())
$$;

create or replace function app.rolle() returns text
language sql stable security definer set search_path = '' as $$
  select p.rolle from public.profil p where p.user_id = (select auth.uid())
$$;

create or replace function app.mitarbeiter_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.mitarbeiter_id from public.profil p where p.user_id = (select auth.uid())
$$;

revoke execute on function app.organisation_id(), app.rolle(), app.mitarbeiter_id() from public, anon;
grant  execute on function app.organisation_id(), app.rolle(), app.mitarbeiter_id() to authenticated;

-- ---------------------------------------------------------------------
-- 4. RECHTE UND ZUGRIFFSREGELN (Row Level Security)
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on public.audit_log from authenticated;

-- 4a) HR und Admin: Vollzugriff im eigenen Mandanten
do $$
declare t text;
begin
  foreach t in array array[
    'tarifzone', 'gesellschaft', 'standort', 'funktion', 'mitarbeiter',
    'dienstverhaeltnis', 'entgelt', 'brutto_tabelle', 'vorlage', 'dokument'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$
      create policy hr_vollzugriff on public.%I for all to authenticated
      using (organisation_id = (select app.organisation_id())
             and (select app.rolle()) in ('admin', 'hr'))
      with check (organisation_id = (select app.organisation_id())
             and (select app.rolle()) in ('admin', 'hr'))
    $p$, t);
  end loop;
end $$;

-- 4b) Alle im Mandanten: Firmen, Standorte, Funktionen lesen
create policy alle_lesen on public.gesellschaft for select to authenticated
  using (organisation_id = (select app.organisation_id()));
create policy alle_lesen on public.standort for select to authenticated
  using (organisation_id = (select app.organisation_id()));
create policy alle_lesen on public.funktion for select to authenticated
  using (organisation_id = (select app.organisation_id()));

-- 4c) Mitarbeiter: nur eigene Daten und Dokumente (kein Entgelt)
create policy eigene_person on public.mitarbeiter for select to authenticated
  using (id = (select app.mitarbeiter_id()));
create policy eigenes_dienstverhaeltnis on public.dienstverhaeltnis for select to authenticated
  using (mitarbeiter_id = (select app.mitarbeiter_id()));
create policy eigene_dokumente on public.dokument for select to authenticated
  using (dienstverhaeltnis_id in (
    select d.id from public.dienstverhaeltnis d
    where d.mitarbeiter_id = (select app.mitarbeiter_id())
  ));

-- 4d) Organisation, Profil, Protokoll
alter table public.organisation enable row level security;
create policy eigene_organisation on public.organisation for select to authenticated
  using (id = (select app.organisation_id()));
create policy admin_aendert_organisation on public.organisation for update to authenticated
  using (id = (select app.organisation_id()) and (select app.rolle()) = 'admin')
  with check (id = (select app.organisation_id()) and (select app.rolle()) = 'admin');

alter table public.profil enable row level security;
create policy eigenes_profil on public.profil for select to authenticated
  using (user_id = (select auth.uid()));
create policy admin_verwaltet_profile on public.profil for all to authenticated
  using (organisation_id = (select app.organisation_id()) and (select app.rolle()) = 'admin')
  with check (organisation_id = (select app.organisation_id()) and (select app.rolle()) = 'admin');

alter table public.audit_log enable row level security;
create policy hr_liest_protokoll on public.audit_log for select to authenticated
  using (organisation_id = (select app.organisation_id())
         and (select app.rolle()) in ('admin', 'hr'));

-- ---------------------------------------------------------------------
-- 5. AUTOMATISCHES ÄNDERUNGSPROTOKOLL
-- ---------------------------------------------------------------------
create or replace function app.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  org uuid;
  rec uuid;
begin
  if tg_op = 'DELETE' then
    org := old.organisation_id; rec := old.id;
  else
    org := new.organisation_id; rec := new.id;
  end if;

  insert into public.audit_log (organisation_id, user_id, tabelle, datensatz_id, aktion, alt, neu)
  values (
    org, (select auth.uid()), tg_table_name, rec, tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return null;
end $$;

revoke execute on function app.audit() from public, anon, authenticated;

create trigger audit_mitarbeiter after insert or update or delete on public.mitarbeiter
  for each row execute function app.audit();
create trigger audit_dienstverhaeltnis after insert or update or delete on public.dienstverhaeltnis
  for each row execute function app.audit();
create trigger audit_entgelt after insert or update or delete on public.entgelt
  for each row execute function app.audit();
create trigger audit_dokument after insert or update or delete on public.dokument
  for each row execute function app.audit();
