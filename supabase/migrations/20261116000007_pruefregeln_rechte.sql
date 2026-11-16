-- =====================================================================
-- Staff-Solutions - Migration 007: Prüfregeln und Rechte beim Anlegen
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Einstellungen je Firma
-- ---------------------------------------------------------------------
alter table public.organisation add column vollzeit_stunden numeric(4,1) not null default 40
  check (vollzeit_stunden > 0 and vollzeit_stunden <= 48);
alter table public.organisation add column geringfuegig_grenze numeric(10,2)
  check (geringfuegig_grenze is null or geringfuegig_grenze > 0);   -- 2026: 551,10 € monatlich
alter table public.organisation add column max_stunden_tag numeric(4,1) not null default 10
  check (max_stunden_tag > 0 and max_stunden_tag <= 12);

-- ---------------------------------------------------------------------
-- 2. Funktion: Bereich und wer sie anlegen darf
--    Büro (admin, geschaeftsfuehrung, hr) darf immer alles.
-- ---------------------------------------------------------------------
alter table public.funktion add column bereich text not null default 'studio'
  check (bereich in ('studio', 'buero'));
alter table public.funktion add column anlegen_durch text[] not null default '{studioleitung,regionalleitung}'
  check (anlegen_durch <@ array['studioleitung', 'regionalleitung']::text[]);
alter table public.funktion add column leiterzulage_moeglich boolean not null default false;
alter table public.funktion add constraint funktion_buero_nur_buero
  check (bereich = 'studio' or anlegen_durch = '{}');

-- ---------------------------------------------------------------------
-- 3. Sensible Daten: Versicherungsnummer kann nachgereicht werden
-- ---------------------------------------------------------------------
alter table public.mitarbeiter_sensibel add column sv_nummer_nachreichen boolean not null default false;

-- ---------------------------------------------------------------------
-- 4. Prüf-Hilfen
-- ---------------------------------------------------------------------

-- Österreichische Versicherungsnummer: 10 Ziffern, 4. Ziffer ist die Prüfziffer
create or replace function app.sv_nummer_gueltig(nr text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  gewichte int[] := array[3, 7, 9, 0, 5, 8, 4, 2, 1, 6];
  summe int := 0;
begin
  if nr !~ '^[0-9]{10}$' then return false; end if;
  for i in 1..10 loop
    summe := summe + substr(nr, i, 1)::int * gewichte[i];
  end loop;
  return summe % 11 = substr(nr, 4, 1)::int;
end $$;

-- IBAN mit Prüfsumme (Modulo 97)
create or replace function app.iban_gueltig(iban text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  s text := upper(replace(coalesce(iban, ''), ' ', ''));
  umgestellt text;
  ziffern text := '';
  rest int := 0;
  z text;
begin
  if s !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$' then return false; end if;
  umgestellt := substr(s, 5) || substr(s, 1, 4);
  foreach z in array regexp_split_to_array(umgestellt, '') loop
    if z ~ '[A-Z]' then
      ziffern := ziffern || (ascii(z) - 55)::text;
    else
      ziffern := ziffern || z;
    end if;
  end loop;
  foreach z in array regexp_split_to_array(ziffern, '') loop
    rest := (rest * 10 + z::int) % 97;
  end loop;
  return rest = 1;
end $$;

-- ---------------------------------------------------------------------
-- 5. Dienstzettel erfassen (Version 3): alle Prüfungen auch hier,
--    damit niemand sie über das Formular hinweg umgehen kann.
-- ---------------------------------------------------------------------
drop function public.dienstzettel_erfassen(uuid, uuid, text, text, date, text, numeric, numeric,
  text, date, text, text, text, text, text, text, text, text, text, int, boolean, numeric);

create function public.dienstzettel_erfassen(
  p_standort_id          uuid,
  p_funktion_id          uuid,
  p_vorname              text,
  p_nachname             text,
  p_eintritt             date,
  p_beschaeftigungsart   text,
  p_wochenstunden        numeric,
  p_arbeitstage_woche    int,
  p_netto                numeric,
  p_anrede               text,
  p_geburtsdatum         date,
  p_strasse              text,
  p_plz                  text,
  p_ort                  text,
  p_telefon              text,
  p_email                text,
  p_staatsangehoerigkeit text,
  p_iban                 text,
  p_sv_nummer            text    default null,
  p_sv_nummer_nachreichen boolean default false,
  p_bic                  text    default null,
  p_sonderzahlung        boolean default false,
  p_leiterzulage_netto   numeric default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org      public.organisation%rowtype;
  v_rolle    text := app.rolle();
  v_standort public.standort%rowtype;
  v_funktion public.funktion%rowtype;
  v_brutto   numeric;
  v_sv       text := nullif(replace(coalesce(p_sv_nummer, ''), ' ', ''), '');
  v_iban     text := upper(replace(coalesce(p_iban, ''), ' ', ''));
  v_alter    int;
  v_ma       uuid;
  v_dv       uuid;
begin
  select * into v_org from public.organisation where id = app.organisation_id();
  if v_org.id is null then
    raise exception 'Dein Zugang ist keiner Firma zugeordnet.';
  end if;

  select * into v_standort from public.standort
  where id = p_standort_id and organisation_id = v_org.id;
  if v_standort.id is null then raise exception 'Bitte ein Studio wählen.'; end if;

  select * into v_funktion from public.funktion
  where id = p_funktion_id and organisation_id = v_org.id;
  if v_funktion.id is null then raise exception 'Bitte eine Funktion wählen.'; end if;

  -- Wer darf diese Funktion an diesem Standort anlegen?
  if v_rolle in ('admin', 'geschaeftsfuehrung', 'hr') then
    null;
  elsif v_rolle in ('studioleitung', 'regionalleitung') then
    if not exists (select 1 from public.zustaendigkeit z
                   where z.user_id = (select auth.uid()) and z.standort_id = p_standort_id) then
      raise exception 'Du bist für dieses Studio nicht zuständig.';
    end if;
    if not (v_rolle = any (v_funktion.anlegen_durch)) then
      raise exception 'Die Funktion % darf nur das Personalbüro anlegen.', v_funktion.name;
    end if;
  else
    raise exception 'Mit deinem Zugang kannst du keine Mitarbeiter anlegen.';
  end if;

  -- Funktion und Arbeitsort müssen zusammenpassen
  if v_funktion.bereich = 'buero' and v_standort.art <> 'buero' then
    raise exception 'Die Funktion % gehört ins Büro. Bitte das Büro als Arbeitsort wählen.', v_funktion.name;
  end if;
  if v_funktion.bereich = 'studio' and v_standort.art = 'buero' then
    raise exception 'Die Funktion % gehört in ein Studio, nicht ins Büro.', v_funktion.name;
  end if;

  -- Pflichtfelder
  if coalesce(trim(p_vorname), '') = '' or coalesce(trim(p_nachname), '') = '' then
    raise exception 'Vor- und Nachname fehlen.'; end if;
  if coalesce(trim(p_anrede), '') = '' then raise exception 'Anrede fehlt.'; end if;
  if p_geburtsdatum is null then raise exception 'Geburtsdatum fehlt.'; end if;
  if coalesce(trim(p_strasse), '') = '' or coalesce(trim(p_ort), '') = '' then
    raise exception 'Adresse ist unvollständig.'; end if;
  if coalesce(p_plz, '') !~ '^[0-9]{4,5}$' then raise exception 'PLZ hat 4 oder 5 Ziffern.'; end if;
  if coalesce(trim(p_telefon), '') !~ '^\+?[0-9 /()-]{6,}$' then raise exception 'Telefonnummer fehlt oder ist ungültig.'; end if;
  if coalesce(trim(p_email), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-Mail-Adresse fehlt oder ist ungültig.'; end if;
  if coalesce(trim(p_staatsangehoerigkeit), '') = '' then raise exception 'Staatsangehörigkeit fehlt.'; end if;

  -- Alter
  v_alter := extract(year from age(p_eintritt, p_geburtsdatum));
  if v_alter < 15 then raise exception 'Zum Dienstantritt ist die Person erst % Jahre alt.', v_alter; end if;
  if v_alter > 80 then raise exception 'Geburtsdatum bitte prüfen (Alter %).', v_alter; end if;

  -- Versicherungsnummer und Bankverbindung
  if v_sv is null and not p_sv_nummer_nachreichen then
    raise exception 'Versicherungsnummer fehlt. Falls es noch keine gibt: "wird nachgereicht" ankreuzen.';
  end if;
  if v_sv is not null and not app.sv_nummer_gueltig(v_sv) then
    raise exception 'Die Versicherungsnummer ist ungültig (Prüfziffer stimmt nicht).';
  end if;
  if not app.iban_gueltig(v_iban) then raise exception 'Die IBAN ist ungültig.'; end if;

  -- Dienstantritt
  if p_eintritt < current_date - 90 then raise exception 'Der Dienstantritt liegt mehr als 3 Monate zurück.'; end if;
  if p_eintritt > current_date + 365 then raise exception 'Der Dienstantritt liegt mehr als 1 Jahr in der Zukunft.'; end if;

  -- Arbeitszeit
  if p_beschaeftigungsart not in ('vollzeit', 'teilzeit', 'geringfuegig') then
    raise exception 'Bitte eine Beschäftigungsart wählen.'; end if;
  if p_arbeitstage_woche is null or p_arbeitstage_woche not between 1 and 6 then
    raise exception 'Arbeitstage pro Woche: 1 bis 6.'; end if;
  if p_wochenstunden is null or p_wochenstunden <= 0 then raise exception 'Stunden pro Woche fehlen.'; end if;
  if p_wochenstunden / p_arbeitstage_woche > v_org.max_stunden_tag then
    raise exception '% Stunden an % Tagen sind % Stunden pro Tag. Höchstens % Stunden pro Tag sind möglich.',
      p_wochenstunden, p_arbeitstage_woche, round(p_wochenstunden / p_arbeitstage_woche, 1), v_org.max_stunden_tag;
  end if;
  if p_beschaeftigungsart = 'vollzeit' and p_wochenstunden <> v_org.vollzeit_stunden then
    raise exception 'Vollzeit sind bei euch % Stunden pro Woche. Bei weniger Stunden bitte Teilzeit wählen.', v_org.vollzeit_stunden;
  end if;
  if p_beschaeftigungsart in ('teilzeit', 'geringfuegig') and p_wochenstunden >= v_org.vollzeit_stunden then
    raise exception 'Mit % Stunden pro Woche ist das Vollzeit.', p_wochenstunden;
  end if;

  -- Entgelt
  if p_netto is null or p_netto <= 0 then raise exception 'Netto pro Monat fehlt.'; end if;
  if p_beschaeftigungsart = 'geringfuegig' and v_org.geringfuegig_grenze is not null
     and p_netto > v_org.geringfuegig_grenze then
    raise exception 'Geringfügig ist nur bis % € pro Monat möglich.', v_org.geringfuegig_grenze;
  end if;
  if p_leiterzulage_netto is not null then
    if not v_funktion.leiterzulage_moeglich then
      raise exception 'Für die Funktion % gibt es keine Leiterzulage.', v_funktion.name; end if;
    if p_leiterzulage_netto <= 0 then
      raise exception 'Leiterzulage muss größer als 0 sein oder leer bleiben.'; end if;
  end if;

  select b.brutto into v_brutto
  from public.brutto_tabelle b
  where b.organisation_id = v_org.id and b.tarifzone_id = v_standort.tarifzone_id
    and b.netto = p_netto and b.gueltig_ab <= p_eintritt
  order by b.gueltig_ab desc
  limit 1;

  -- Speichern
  insert into public.mitarbeiter (organisation_id, anrede, vorname, nachname, geburtsdatum,
                                  strasse, plz, ort, telefon, email)
  values (v_org.id, trim(p_anrede), trim(p_vorname), trim(p_nachname), p_geburtsdatum,
          trim(p_strasse), p_plz, trim(p_ort), trim(p_telefon), lower(trim(p_email)))
  returning id into v_ma;

  insert into public.mitarbeiter_sensibel (mitarbeiter_id, organisation_id, sv_nummer, sv_nummer_nachreichen,
                                           iban, bic, staatsangehoerigkeit)
  values (v_ma, v_org.id, v_sv, v_sv is null, v_iban, nullif(upper(trim(coalesce(p_bic, ''))), ''),
          trim(p_staatsangehoerigkeit));

  insert into public.dienstverhaeltnis (organisation_id, mitarbeiter_id, gesellschaft_id,
         heimstandort_id, funktion_id, beschaeftigungsart, wochenstunden,
         arbeitstage_woche, sonderzahlung, eintritt)
  values (v_org.id, v_ma, v_standort.gesellschaft_id, p_standort_id, p_funktion_id, p_beschaeftigungsart,
          p_wochenstunden, p_arbeitstage_woche, p_sonderzahlung, p_eintritt)
  returning id into v_dv;

  insert into public.entgelt (organisation_id, dienstverhaeltnis_id, netto, brutto, quelle, gueltig_ab)
  values (v_org.id, v_dv, p_netto, v_brutto,
          case when v_brutto is null then 'offen' else 'tabelle' end, p_eintritt);

  if p_leiterzulage_netto is not null then
    insert into public.zulage (organisation_id, dienstverhaeltnis_id, art, netto, gueltig_ab)
    values (v_org.id, v_dv, 'Leiterzulage', p_leiterzulage_netto, p_eintritt);
  end if;

  return v_dv;
end $$;

revoke execute on function public.dienstzettel_erfassen from public, anon;
grant  execute on function public.dienstzettel_erfassen to authenticated;
revoke execute on function app.sv_nummer_gueltig(text), app.iban_gueltig(text) from public, anon;
grant  execute on function app.sv_nummer_gueltig(text), app.iban_gueltig(text) to authenticated;

-- Grundregel auch direkt in der Tabelle: nie mehr als 12 Stunden pro Tag.
-- "not valid": gilt für alle neuen und geänderten Einträge; bestehende Testeinträge bleiben unberührt.
alter table public.dienstverhaeltnis add constraint dienstverhaeltnis_stunden_pro_tag_check
  check (arbeitstage_woche is null or wochenstunden / arbeitstage_woche <= 12) not valid;
