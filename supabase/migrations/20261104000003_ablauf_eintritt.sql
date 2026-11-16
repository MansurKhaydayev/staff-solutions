-- =====================================================================
-- Staff-Solutions - Migration 003: Ablauf Eintritt
-- Rollen, Zuständigkeiten, Lohnverrechner, sensible Daten, Zulagen,
-- Probearbeit, Unterschriften, Fristberechnung, Erfassung Dienstzettel
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ROLLEN
-- ---------------------------------------------------------------------
alter table public.profil drop constraint profil_rolle_check;
alter table public.profil add constraint profil_rolle_check check (rolle in (
  'admin', 'geschaeftsfuehrung', 'hr', 'regionalleitung', 'studioleitung', 'mitarbeiter'
));

-- Büro = admin, Geschäftsführung, HR (sehen alles im eigenen Mandanten)
create or replace function app.ist_buero() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.rolle from public.profil p where p.user_id = (select auth.uid()))
                  in ('admin', 'geschaeftsfuehrung', 'hr'), false)
$$;

-- ---------------------------------------------------------------------
-- 2. ZUSTÄNDIGKEIT: welche Studios betreut eine Studio-/Regionalleitung
-- ---------------------------------------------------------------------
create table public.zustaendigkeit (
  user_id          uuid not null references auth.users(id) on delete cascade,
  standort_id      uuid not null,
  organisation_id  uuid not null references public.organisation(id),
  primary key (user_id, standort_id),
  foreign key (standort_id, organisation_id) references public.standort (id, organisation_id)
);
create index on public.zustaendigkeit (standort_id, organisation_id);
create index on public.zustaendigkeit (organisation_id);

create or replace function app.meine_standorte() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select z.standort_id from public.zustaendigkeit z where z.user_id = (select auth.uid())
$$;

-- ---------------------------------------------------------------------
-- 3. LOHNVERRECHNER (je GmbH zugeordnet)
-- ---------------------------------------------------------------------
create table public.lohnverrechner (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisation(id),
  name             text not null,
  email            text,
  unique (organisation_id, name),
  unique (id, organisation_id)
);
create index on public.lohnverrechner (organisation_id);

alter table public.gesellschaft add column lohnverrechner_id uuid;
alter table public.gesellschaft add foreign key (lohnverrechner_id, organisation_id)
  references public.lohnverrechner (id, organisation_id);
create index on public.gesellschaft (lohnverrechner_id, organisation_id);

-- ---------------------------------------------------------------------
-- 4. MITARBEITER: neue Felder + sensible Daten in eigener Tabelle
-- ---------------------------------------------------------------------
alter table public.mitarbeiter add column anrede text;
alter table public.mitarbeiter add column telefon text;

-- Nur Büro darf lesen. Studioleitung trägt über die Funktion
-- public.dienstzettel_erfassen ein, kann die Daten danach aber nicht mehr sehen.
create table public.mitarbeiter_sensibel (
  mitarbeiter_id        uuid primary key,
  organisation_id       uuid not null references public.organisation(id),
  sv_nummer             text check (sv_nummer is null or sv_nummer ~ '^[0-9]{10}$'),
  iban                  text,
  bic                   text,
  staatsangehoerigkeit  text,
  foreign key (mitarbeiter_id, organisation_id) references public.mitarbeiter (id, organisation_id)
);
create index on public.mitarbeiter_sensibel (mitarbeiter_id, organisation_id);
create index on public.mitarbeiter_sensibel (organisation_id);

-- ---------------------------------------------------------------------
-- 5. DIENSTVERHÄLTNIS: neue Felder
-- ---------------------------------------------------------------------
alter table public.dienstverhaeltnis add column arbeitstage_woche int
  check (arbeitstage_woche between 1 and 7);
alter table public.dienstverhaeltnis add column sonderzahlung boolean not null default false;

-- ---------------------------------------------------------------------
-- 6. ENTGELT: Brutto darf offen sein, wenn es nicht in der Tabelle steht
-- ---------------------------------------------------------------------
alter table public.entgelt alter column brutto drop not null;
alter table public.entgelt drop constraint entgelt_quelle_check;
alter table public.entgelt add constraint entgelt_quelle_check
  check (quelle in ('tabelle', 'manuell', 'offen'));
alter table public.entgelt add constraint entgelt_brutto_offen_check
  check ((quelle = 'offen') = (brutto is null));

-- ---------------------------------------------------------------------
-- 7. ZULAGEN (z. B. Leiterzulage) mit Zeitraum
-- ---------------------------------------------------------------------
create table public.zulage (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisation(id),
  dienstverhaeltnis_id uuid not null,
  art                  text not null,
  netto                numeric(10,2) not null check (netto >= 0),
  brutto               numeric(10,2) check (brutto >= 0),
  gueltig_ab           date not null,
  gueltig_bis          date,
  created_at           timestamptz not null default now(),
  check (gueltig_bis is null or gueltig_bis >= gueltig_ab),
  foreign key (dienstverhaeltnis_id, organisation_id) references public.dienstverhaeltnis (id, organisation_id)
);
create index on public.zulage (dienstverhaeltnis_id, organisation_id);
create index on public.zulage (organisation_id);

-- ---------------------------------------------------------------------
-- 8. PROBEARBEIT
-- ---------------------------------------------------------------------
create table public.probearbeit (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisation(id),
  standort_id      uuid not null,
  vorname          text not null,
  nachname         text not null,
  geburtsdatum     date,
  strasse          text,
  plz              text,
  ort              text,
  datum            date not null,
  von              time not null,
  bis              time not null,
  betreut_von      uuid references auth.users(id) default auth.uid(),
  mitarbeiter_id   uuid,             -- wird gesetzt, wenn die Person eingestellt wird
  created_at       timestamptz not null default now(),
  unique (id, organisation_id),
  check (bis > von),
  foreign key (standort_id, organisation_id)    references public.standort (id, organisation_id),
  foreign key (mitarbeiter_id, organisation_id) references public.mitarbeiter (id, organisation_id)
);
create index on public.probearbeit (standort_id, organisation_id);
create index on public.probearbeit (mitarbeiter_id, organisation_id);
create index on public.probearbeit (organisation_id, datum desc);
create index on public.probearbeit (betreut_von);

-- ---------------------------------------------------------------------
-- 9. DOKUMENTE: neue Typen, neuer Status, Fristen, Probearbeit
-- ---------------------------------------------------------------------
alter table public.vorlage drop constraint vorlage_typ_check;
alter table public.vorlage add constraint vorlage_typ_check check (typ in (
  'probearbeit', 'dienstzettel', 'dienstvertrag', 'einzelvereinbarung',
  'einwilligung_wechsel', 'mitteilung_unbefristet', 'onboarding',
  'anmeldebestaetigung', 'sonstiges'
));

alter table public.dokument drop constraint dokument_typ_check;
alter table public.dokument add constraint dokument_typ_check check (typ in (
  'probearbeit', 'dienstzettel', 'dienstvertrag', 'einzelvereinbarung',
  'einwilligung_wechsel', 'mitteilung_unbefristet', 'onboarding',
  'anmeldebestaetigung', 'sonstiges'
));

-- entwurf -> freigegeben (beim Regionalleiter) -> unterschrieben ("wird geprüft")
--         -> abgeschlossen;  abgelehnt = Mitarbeiter unterschreibt nicht
alter table public.dokument drop constraint dokument_status_check;
alter table public.dokument add constraint dokument_status_check check (status in (
  'entwurf', 'freigegeben', 'unterschrieben', 'abgeschlossen', 'abgelehnt'
));

-- Unterschriften kommen in eine eigene Tabelle (siehe 10.)
alter table public.dokument drop column unterschrieben_am;
alter table public.dokument drop column unterschrieben_von;
alter table public.dokument drop column gegengezeichnet_am;
alter table public.dokument drop column gegengezeichnet_von;

alter table public.dokument add column freigegeben_am timestamptz;
alter table public.dokument add column faellig_am date;   -- z. B. 5 Werktage nach Freigabe
alter table public.dokument add column probearbeit_id uuid;
alter table public.dokument add column bezeichnung text;  -- z. B. "Leiterzulage"
alter table public.dokument alter column dienstverhaeltnis_id drop not null;
alter table public.dokument add foreign key (probearbeit_id, organisation_id)
  references public.probearbeit (id, organisation_id);
alter table public.dokument add constraint dokument_bezug_check
  check (dienstverhaeltnis_id is not null or probearbeit_id is not null);
create index on public.dokument (probearbeit_id, organisation_id);
create index on public.dokument (organisation_id, faellig_am) where status = 'freigegeben';

-- ---------------------------------------------------------------------
-- 10. UNTERSCHRIFTEN (wer hat wann in welcher Rolle unterschrieben)
--     Einträge können nie geändert oder gelöscht werden.
-- ---------------------------------------------------------------------
create table public.unterschrift (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisation(id),
  dokument_id      uuid not null,
  rolle            text not null check (rolle in (
                     'mitarbeiter', 'bewerber', 'arbeitgeber', 'studioleitung', 'regionalleitung')),
  user_id          uuid references auth.users(id) default auth.uid(),
  name             text not null,
  datei_hash       text,
  zeitpunkt        timestamptz not null default now()
);
alter table public.dokument add constraint dokument_id_org_key unique (id, organisation_id);
alter table public.unterschrift add foreign key (dokument_id, organisation_id)
  references public.dokument (id, organisation_id);
create index on public.unterschrift (dokument_id, organisation_id);
create index on public.unterschrift (organisation_id);
create index on public.unterschrift (user_id);

-- ---------------------------------------------------------------------
-- 11. AUTOMATISCHE FRISTBERECHNUNG
-- Ende = Tag vor dem gleichen Kalendertag n Monate später.
-- Gibt es diesen Tag nicht (z. B. 31.01. + 3 Monate), endet die Frist
-- am letzten Tag des Zielmonats.
--   01.11.2026 + 3 -> 31.01.2027   |   31.01.2027 + 3 -> 30.04.2027
-- ---------------------------------------------------------------------
create or replace function app.fristende(beginn date, monate int) returns date
language plpgsql immutable set search_path = '' as $$
declare
  ziel date := (beginn + make_interval(months => monate))::date;
begin
  if extract(day from ziel) < extract(day from beginn) then
    return ziel;          -- Zieltag existiert nicht: letzter Tag des Monats
  end if;
  return ziel - 1;
end $$;

create or replace function app.befristung_setzen() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  monate int;
begin
  if new.befristet_bis is null then
    select o.befristung_monate into monate
    from public.organisation o where o.id = new.organisation_id;
    if monate > 0 then
      new.befristet_bis := app.fristende(new.eintritt, monate);
    end if;
  end if;
  return new;
end $$;

create trigger befristung_setzen before insert on public.dienstverhaeltnis
  for each row execute function app.befristung_setzen();

-- ---------------------------------------------------------------------
-- 12. ERFASSUNG DIENSTZETTEL (eine Funktion für die Studioleitung)
-- Legt Mitarbeiter, sensible Daten, Dienstverhältnis und Entgelt in
-- einem Schritt an. GmbH, Befristung und Brutto werden automatisch ermittelt.
-- ---------------------------------------------------------------------
create or replace function public.dienstzettel_erfassen(
  p_standort_id          uuid,
  p_funktion_id          uuid,
  p_vorname              text,
  p_nachname             text,
  p_eintritt             date,
  p_beschaeftigungsart   text,
  p_wochenstunden        numeric,
  p_netto                numeric,
  p_anrede               text    default null,
  p_geburtsdatum         date    default null,
  p_strasse              text    default null,
  p_plz                  text    default null,
  p_ort                  text    default null,
  p_telefon              text    default null,
  p_email                text    default null,
  p_staatsangehoerigkeit text    default null,
  p_sv_nummer            text    default null,
  p_iban                 text    default null,
  p_bic                  text    default null,
  p_arbeitstage_woche    int     default null,
  p_sonderzahlung        boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org      uuid := app.organisation_id();
  v_rolle    text := app.rolle();
  v_gmbh     uuid;
  v_zone     uuid;
  v_brutto   numeric;
  v_ma       uuid;
  v_dv       uuid;
begin
  if v_org is null then
    raise exception 'Kein Profil gefunden';
  end if;

  -- Studio muss zum eigenen Mandanten gehören
  select s.gesellschaft_id, s.tarifzone_id into v_gmbh, v_zone
  from public.standort s
  where s.id = p_standort_id and s.organisation_id = v_org;
  if v_gmbh is null then
    raise exception 'Studio nicht gefunden';
  end if;

  -- Büro darf überall, Leitung nur in eigenen Studios
  if not (v_rolle in ('admin', 'geschaeftsfuehrung', 'hr')
          or (v_rolle in ('studioleitung', 'regionalleitung')
              and exists (select 1 from public.zustaendigkeit z
                          where z.user_id = (select auth.uid())
                            and z.standort_id = p_standort_id))) then
    raise exception 'Keine Berechtigung für dieses Studio';
  end if;

  -- Brutto aus der Tabelle (gültig zum Eintritt, passende Tarifzone)
  select b.brutto into v_brutto
  from public.brutto_tabelle b
  where b.organisation_id = v_org and b.tarifzone_id = v_zone
    and b.netto = p_netto and b.gueltig_ab <= p_eintritt
  order by b.gueltig_ab desc
  limit 1;

  insert into public.mitarbeiter (organisation_id, anrede, vorname, nachname, geburtsdatum,
                                  strasse, plz, ort, telefon, email)
  values (v_org, p_anrede, p_vorname, p_nachname, p_geburtsdatum,
          p_strasse, p_plz, p_ort, p_telefon, p_email)
  returning id into v_ma;

  insert into public.mitarbeiter_sensibel (mitarbeiter_id, organisation_id, sv_nummer,
                                           iban, bic, staatsangehoerigkeit)
  values (v_ma, v_org, nullif(replace(p_sv_nummer, ' ', ''), ''),
          nullif(upper(replace(p_iban, ' ', '')), ''), nullif(upper(trim(p_bic)), ''),
          p_staatsangehoerigkeit);

  insert into public.dienstverhaeltnis (organisation_id, mitarbeiter_id, gesellschaft_id,
         heimstandort_id, funktion_id, beschaeftigungsart, wochenstunden,
         arbeitstage_woche, sonderzahlung, eintritt)
  values (v_org, v_ma, v_gmbh, p_standort_id, p_funktion_id, p_beschaeftigungsart,
          p_wochenstunden, p_arbeitstage_woche, p_sonderzahlung, p_eintritt)
  returning id into v_dv;

  insert into public.entgelt (organisation_id, dienstverhaeltnis_id, netto, brutto, quelle, gueltig_ab)
  values (v_org, v_dv, p_netto, v_brutto,
          case when v_brutto is null then 'offen' else 'tabelle' end, p_eintritt);

  return v_dv;
end $$;

revoke execute on function public.dienstzettel_erfassen from public, anon;
grant  execute on function public.dienstzettel_erfassen to authenticated;

-- ---------------------------------------------------------------------
-- 13. RECHTE UND ZUGRIFFSREGELN
-- ---------------------------------------------------------------------
revoke execute on function app.ist_buero(), app.meine_standorte() from public, anon;
grant  execute on function app.ist_buero(), app.meine_standorte() to authenticated;
revoke execute on function app.befristung_setzen() from public, anon, authenticated;

revoke all on public.zustaendigkeit, public.lohnverrechner, public.mitarbeiter_sensibel,
              public.zulage, public.probearbeit, public.unterschrift from anon;
grant select, insert, update, delete on public.zustaendigkeit, public.lohnverrechner,
              public.mitarbeiter_sensibel, public.zulage, public.probearbeit to authenticated;
grant select, insert on public.unterschrift to authenticated;   -- nie ändern/löschen

-- 13a) Büro-Vollzugriff (ersetzt die bisherigen HR-Regeln, inkl. Geschäftsführung)
do $$
declare t text;
begin
  foreach t in array array[
    'tarifzone', 'gesellschaft', 'standort', 'funktion', 'mitarbeiter',
    'dienstverhaeltnis', 'entgelt', 'brutto_tabelle', 'vorlage', 'dokument'
  ] loop
    execute format('drop policy hr_vollzugriff on public.%I', t);
  end loop;

  foreach t in array array[
    'tarifzone', 'gesellschaft', 'standort', 'funktion', 'mitarbeiter',
    'dienstverhaeltnis', 'entgelt', 'brutto_tabelle', 'vorlage', 'dokument',
    'zustaendigkeit', 'lohnverrechner', 'mitarbeiter_sensibel', 'zulage', 'probearbeit'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$
      create policy buero_vollzugriff on public.%I for all to authenticated
      using (organisation_id = (select app.organisation_id()) and (select app.ist_buero()))
      with check (organisation_id = (select app.organisation_id()) and (select app.ist_buero()))
    $p$, t);
  end loop;
end $$;

alter table public.unterschrift enable row level security;
create policy buero_lesen on public.unterschrift for select to authenticated
  using (organisation_id = (select app.organisation_id()) and (select app.ist_buero()));
create policy buero_unterschreiben on public.unterschrift for insert to authenticated
  with check (organisation_id = (select app.organisation_id()) and (select app.ist_buero())
              and user_id = (select auth.uid()));

drop policy hr_liest_protokoll on public.audit_log;
create policy buero_liest_protokoll on public.audit_log for select to authenticated
  using (organisation_id = (select app.organisation_id()) and (select app.ist_buero()));

-- 13b) Studio- und Regionalleitung: nur die eigenen Studios
create policy eigene_zustaendigkeit on public.zustaendigkeit for select to authenticated
  using (user_id = (select auth.uid()));

create policy leitung_dienstverhaeltnis on public.dienstverhaeltnis for select to authenticated
  using (organisation_id = (select app.organisation_id())
         and heimstandort_id in (select app.meine_standorte()));

create policy leitung_mitarbeiter on public.mitarbeiter for select to authenticated
  using (organisation_id = (select app.organisation_id())
         and id in (select d.mitarbeiter_id from public.dienstverhaeltnis d
                    where d.heimstandort_id in (select app.meine_standorte())));

create policy leitung_dokumente on public.dokument for select to authenticated
  using (organisation_id = (select app.organisation_id())
         and (dienstverhaeltnis_id in (select d.id from public.dienstverhaeltnis d
                                       where d.heimstandort_id in (select app.meine_standorte()))
              or probearbeit_id in (select p.id from public.probearbeit p
                                    where p.standort_id in (select app.meine_standorte()))));

create policy leitung_probearbeit on public.probearbeit for all to authenticated
  using (organisation_id = (select app.organisation_id())
         and standort_id in (select app.meine_standorte()))
  with check (organisation_id = (select app.organisation_id())
         and standort_id in (select app.meine_standorte()));

-- ---------------------------------------------------------------------
-- 14. ÄNDERUNGSPROTOKOLL für die neuen Tabellen
-- ---------------------------------------------------------------------
create trigger audit_zulage after insert or update or delete on public.zulage
  for each row execute function app.audit();
create trigger audit_probearbeit after insert or update or delete on public.probearbeit
  for each row execute function app.audit();
create trigger audit_unterschrift after insert on public.unterschrift
  for each row execute function app.audit();

-- mitarbeiter_sensibel hat keine eigene id-Spalte -> eigener Protokoll-Trigger,
-- der bewusst KEINE Werte speichert (nur dass etwas geändert wurde).
create or replace function app.audit_sensibel() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  insert into public.audit_log (organisation_id, user_id, tabelle, datensatz_id, aktion)
  values (r.organisation_id, (select auth.uid()), tg_table_name, r.mitarbeiter_id, tg_op);
  return null;
end $$;
revoke execute on function app.audit_sensibel() from public, anon, authenticated;

create trigger audit_mitarbeiter_sensibel after insert or update or delete on public.mitarbeiter_sensibel
  for each row execute function app.audit_sensibel();
