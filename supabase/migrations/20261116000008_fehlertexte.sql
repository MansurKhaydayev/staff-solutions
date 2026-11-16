-- =====================================================================
-- Staff-Solutions - Migration 008: verständliche Fehlertexte
-- Zahlen im österreichischen Format (40 statt 40.0, 551,10 statt 551.10)
-- =====================================================================

-- Zahl ohne unnötige Nachkommastellen, mit Komma: 40 / 7,5
create or replace function app.zahl(n numeric) returns text
language sql immutable set search_path = '' as $$
  select replace(trim(trailing '.' from trim(trailing '0' from round(n, 1)::text)), '.', ',')
$$;

-- Geldbetrag: 1.234,50
create or replace function app.betrag(n numeric) returns text
language sql immutable set search_path = '' as $$
  select replace(replace(replace(to_char(n, 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.')
$$;

revoke execute on function app.zahl(numeric), app.betrag(numeric) from public, anon;
grant  execute on function app.zahl(numeric), app.betrag(numeric) to authenticated;

create or replace function public.dienstzettel_erfassen(
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
      raise exception 'Die Funktion % darfst du nicht anlegen. Das übernimmt %.', v_funktion.name,
        case when 'regionalleitung' = any (v_funktion.anlegen_durch)
             then 'die Regionalleitung oder das Personalbüro' else 'das Personalbüro' end;
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
    raise exception '% Stunden an % % sind % Stunden pro Tag. Höchstens % Stunden pro Tag sind möglich.',
      app.zahl(p_wochenstunden), p_arbeitstage_woche,
      case when p_arbeitstage_woche = 1 then 'Tag' else 'Tagen' end,
      app.zahl(p_wochenstunden / p_arbeitstage_woche), app.zahl(v_org.max_stunden_tag);
  end if;
  if p_beschaeftigungsart = 'vollzeit' and p_wochenstunden <> v_org.vollzeit_stunden then
    raise exception 'Vollzeit sind bei euch % Stunden pro Woche. Bei weniger Stunden bitte Teilzeit wählen.', app.zahl(v_org.vollzeit_stunden);
  end if;
  if p_beschaeftigungsart in ('teilzeit', 'geringfuegig') and p_wochenstunden >= v_org.vollzeit_stunden then
    raise exception 'Mit % Stunden pro Woche ist das Vollzeit.', app.zahl(p_wochenstunden);
  end if;

  -- Entgelt
  if p_netto is null or p_netto <= 0 then raise exception 'Netto pro Monat fehlt.'; end if;
  if p_beschaeftigungsart = 'geringfuegig' and v_org.geringfuegig_grenze is not null
     and p_netto > v_org.geringfuegig_grenze then
    raise exception 'Geringfügig ist nur bis € % pro Monat möglich.', app.betrag(v_org.geringfuegig_grenze);
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

