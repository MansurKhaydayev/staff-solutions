-- Unterschriftsmappe, Teil 2: Dienstzettel mit Fristregel und dringender Anmeldung,
-- kein Dienstantritt in der Vergangenheit, Hinweis „angemeldet“.

alter table public.dienstverhaeltnis add column dringend_grund text;
alter table public.dienstverhaeltnis add column dringend_von uuid references auth.users(id);
alter table public.dienstverhaeltnis add column dringend_am timestamptz;
create index on public.dienstverhaeltnis (dringend_von);

-- Angemeldet = eine Anmeldebestätigung (Kategorie „anmeldung“) mit Datei liegt in der Akte
create or replace function app.angemeldet(p_dv uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.dokument x where x.dienstverhaeltnis_id = p_dv and x.kategorie = 'anmeldung'
                 and x.datei_pfad is not null and x.ersetzt_durch is null)
$$;
revoke execute on function app.angemeldet(uuid) from public, anon;
grant execute on function app.angemeldet(uuid) to authenticated;

-- Dienstzettel: neue Fassung mit p_dringend_grund (alte Signatur entfernen)
drop function public.dienstzettel_erfassen(uuid, uuid, text, text, date, text, numeric, int, numeric, text, date, text, text,
  text, text, text, text, text, text, boolean, text, boolean, numeric);

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
  p_leiterzulage_netto   numeric default null,
  p_dringend_grund       text    default null
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
  v_frueh    date;
  v_dringend boolean := false;
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
  -- Dienstantritt: nicht in der Vergangenheit, Fristregel (außer dringende Anmeldung mit Grund)
  if p_eintritt < app.heute_wien() then raise exception 'Der Dienstantritt kann nicht in der Vergangenheit liegen.'; end if;
  if p_eintritt > app.heute_wien() + 365 then raise exception 'Der Dienstantritt liegt mehr als 1 Jahr in der Zukunft.'; end if;
  v_frueh := app.fruehester_dienstantritt(v_org.id, app.jetzt_wien());
  if p_eintritt < v_frueh then
    if coalesce(trim(p_dringend_grund), '') = '' then raise exception '%', app.frist_meldung(v_frueh); end if;
    v_dringend := true;
  end if;

  -- Arbeitszeit und Entgelt (gemeinsame Regeln, siehe app.arbeitszeit_pruefen)
  perform app.arbeitszeit_pruefen(v_org, p_beschaeftigungsart, p_wochenstunden, p_arbeitstage_woche, p_netto);
  if p_leiterzulage_netto is not null then
    if not v_funktion.leiterzulage_moeglich then
      raise exception 'Für die Funktion % gibt es keine Leiterzulage.', v_funktion.name; end if;
    if p_leiterzulage_netto <= 0 then
      raise exception 'Leiterzulage muss größer als 0 sein oder leer bleiben.'; end if;
  end if;

  v_brutto := app.brutto_fuer(v_org.id, v_standort.tarifzone_id, p_netto, p_eintritt);

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
         arbeitstage_woche, sonderzahlung, eintritt, dringend_grund, dringend_von, dringend_am)
  values (v_org.id, v_ma, v_standort.gesellschaft_id, p_standort_id, p_funktion_id, p_beschaeftigungsart,
          p_wochenstunden, p_arbeitstage_woche, p_sonderzahlung, p_eintritt,
          case when v_dringend then trim(p_dringend_grund) end,
          case when v_dringend then auth.uid() end,
          case when v_dringend then now() end)
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

revoke execute on function public.dienstzettel_erfassen(uuid, uuid, text, text, date, text, numeric, int, numeric, text, date,
  text, text, text, text, text, text, text, text, boolean, text, boolean, numeric, text) from public, anon;
grant execute on function public.dienstzettel_erfassen(uuid, uuid, text, text, date, text, numeric, int, numeric, text, date,
  text, text, text, text, text, text, text, text, boolean, text, boolean, numeric, text) to authenticated;

-- Akte-Kopf mit „angemeldet“ und Dringend-Grund
create or replace function public.akte_kopf(p_dienstverhaeltnis_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_dv   public.dienstverhaeltnis%rowtype;
  v_ma   public.mitarbeiter%rowtype;
  v_st   public.standort%rowtype;
  v_tag  date;
  v_k    boolean; v_p boolean; v_e boolean; v_l boolean; v_d boolean;
  v_kopf jsonb;
  v_stand public.vertragsstand%rowtype;
begin
  if not app.in_reichweite(p_dienstverhaeltnis_id) then raise exception 'Keine Berechtigung für diese Akte.'; end if;
  select * into v_dv from public.dienstverhaeltnis where id = p_dienstverhaeltnis_id;
  select * into v_ma from public.mitarbeiter where id = v_dv.mitarbeiter_id;
  select * into v_st from public.standort where id = v_dv.heimstandort_id;
  v_tag := greatest(current_date, v_dv.eintritt);
  v_k := app.sieht('kontakt', v_st.id);
  v_p := app.sieht('personendaten', v_st.id);
  v_e := app.sieht('entgelt', v_st.id);
  v_l := app.sieht('lohnverrechnung', v_st.id);
  v_d := app.sieht('dokumente', v_st.id);

  v_kopf := jsonb_build_object(
    'dienstverhaeltnis_id', v_dv.id, 'mitarbeiter_id', v_ma.id, 'vorname', v_ma.vorname, 'nachname', v_ma.nachname,
    'funktion', (select f.name from public.funktion f where f.id = v_dv.funktion_id),
    'arbeitsort', coalesce(v_st.vertragsbezeichnung, v_st.name), 'standort_id', v_st.id, 'standort_art', v_st.art,
    'gesellschaft', (select g.name from public.gesellschaft g where g.id = v_dv.gesellschaft_id),
    'eintritt', v_dv.eintritt, 'austritt', v_dv.austritt,
    'angemeldet', app.angemeldet(v_dv.id), 'dringend_grund', v_dv.dringend_grund,
    'rechte', jsonb_build_object('kontakt', v_k, 'personendaten', v_p, 'entgelt', v_e, 'lohnverrechnung', v_l,
      'dokumente', v_d, 'buero', app.ist_buero(), 'hochladen_onboarding', app.darf_hochladen('onboarding', v_dv.id)));

  if v_k then
    v_kopf := v_kopf || jsonb_build_object('telefon', v_ma.telefon, 'email', v_ma.email);
  end if;
  if v_p then
    v_stand := app.stand_am(v_dv.id, v_tag);
    v_kopf := v_kopf || jsonb_build_object(
      'befristet_bis', v_dv.befristet_bis,
      'anrede', v_ma.anrede, 'geburtsdatum', v_ma.geburtsdatum, 'strasse', v_ma.strasse, 'plz', v_ma.plz, 'ort', v_ma.ort,
      'stand', jsonb_build_object('id', v_stand.id, 'gueltig_ab', v_stand.gueltig_ab, 'beschaeftigungsart', v_stand.beschaeftigungsart,
        'wochenstunden', v_stand.wochenstunden, 'arbeitstage_woche', v_stand.arbeitstage_woche),
      'kuenftig', coalesce((select jsonb_agg(jsonb_build_object('gueltig_ab', v.gueltig_ab, 'beschaeftigungsart', v.beschaeftigungsart,
          'wochenstunden', v.wochenstunden, 'arbeitstage_woche', v.arbeitstage_woche) order by v.gueltig_ab)
        from public.vertragsstand v where v.dienstverhaeltnis_id = v_dv.id and v.storniert_am is null and v.gueltig_ab > v_tag), '[]'),
      'nachweis_fehlt', coalesce((select jsonb_agg(t) from app.staende_ohne_nachweis(v_dv.id) t), '[]'));
  end if;
  if v_e then
    v_kopf := v_kopf || jsonb_build_object(
      'entgelt', (select jsonb_build_object('netto', e.netto, 'brutto', e.brutto, 'quelle', e.quelle, 'gueltig_ab', e.gueltig_ab)
        from public.entgelt e where e.dienstverhaeltnis_id = v_dv.id and e.storniert_am is null and e.gueltig_ab <= v_tag
        order by e.gueltig_ab desc limit 1),
      'zulagen', coalesce((select jsonb_agg(jsonb_build_object('art', z.art, 'netto', z.netto, 'gueltig_ab', z.gueltig_ab))
        from public.zulage z where z.dienstverhaeltnis_id = v_dv.id and (z.gueltig_bis is null or z.gueltig_bis >= current_date)), '[]'),
      'sonderzahlung', v_dv.sonderzahlung);
  end if;
  if v_l then
    v_kopf := v_kopf || jsonb_build_object('sv_nachreichen',
      coalesce((select s.sv_nummer_nachreichen from public.mitarbeiter_sensibel s where s.mitarbeiter_id = v_ma.id), false));
  end if;
  if v_d then
    v_kopf := v_kopf || jsonb_build_object('onboarding', (
      select jsonb_build_object(
        'gesamt', count(*),
        'erledigt', count(*) filter (where o.status not in ('fehlt', 'klaerung')),
        'fehlt', coalesce(jsonb_agg(o.bezeichnung order by o.reihenfolge) filter (where o.status = 'fehlt'), '[]'),
        'klaerung', coalesce(jsonb_agg(o.bezeichnung order by o.reihenfolge) filter (where o.status = 'klaerung'), '[]'))
      from public.onboarding_stand(v_dv.id) o));
  end if;
  return v_kopf;
end $$;


-- Verzeichnis mit „angemeldet“ (neue Spalte → Funktion neu anlegen)
drop function public.mitarbeiter_verzeichnis();
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
  befristet_bis        date,
  angemeldet           boolean
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
         case when ich.sieht_personendaten then coalesce(s.beschaeftigungsart, d.beschaeftigungsart) end,
         case when ich.sieht_personendaten then coalesce(s.wochenstunden, d.wochenstunden) end,
         case when ich.sieht_personendaten then d.befristet_bis end,
         app.angemeldet(d.id)
  from ich
  join public.dienstverhaeltnis d on d.organisation_id = ich.organisation_id
  join public.mitarbeiter m on m.id = d.mitarbeiter_id
  left join lateral app.stand_am(d.id, greatest(current_date, d.eintritt)) s on true
  where case ich.reichweite
          when 'alle' then true
          when 'zugeordnet' then exists (select 1 from public.zustaendigkeit z
                                         where z.user_id = ich.user_id and z.standort_id = d.heimstandort_id)
          else m.id = ich.mitarbeiter_id
        end
$$;

revoke execute on function public.mitarbeiter_verzeichnis() from public, anon;
grant execute on function public.mitarbeiter_verzeichnis() to authenticated;
