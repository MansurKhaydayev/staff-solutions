-- Austritt, Storno und Mail-Knöpfe, Teil 4: PDF „Austrittsmeldung“, „Storno der Anmeldung“ und „Korrektur“
-- für den Lohnverrechner. Die Edge Function „mappe“ erzeugt das PDF aus meldung_inhalt und legt es mit
-- meldung_ablegen in der Akte ab (Kategorie „abmeldung“ bzw. „storno“).

-- Inhalt im Format von pdf.js (kopf, titel, untertitel, felder, abschnitte); ohne Zeitstempel, damit die Fassung gleich bleibt
create or replace function app.meldung_inhalt(p_meldung_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_m    public.austritt_meldung%rowtype;
  v_vor  public.austritt_meldung%rowtype;
  v_dv   public.dienstverhaeltnis%rowtype;
  v_ma   public.mitarbeiter%rowtype;
  v_g    public.gesellschaft%rowtype;
  v_st   public.standort%rowtype;
  v_lv   text;
  v_sv   text;
  v_art  text;
  v_typ  text;
  v_titel text;
  v_felder jsonb;
  v_inhalt jsonb;
  d      text;
begin
  select * into v_m from public.austritt_meldung where id = p_meldung_id;
  if v_m.id is null then raise exception 'Diese Meldung wurde nicht gefunden.'; end if;
  if v_m.ersetzt_durch is not null then raise exception 'Diese Meldung wurde inzwischen geändert. Bitte die Seite neu laden.'; end if;
  v_art := app.meldung_art(v_m);
  if v_art is null then raise exception 'Für diese Meldung ist nichts an den Lohnverrechner zu schicken.'; end if;
  v_typ := case v_art when 'abmeldung' then 'austrittsmeldung' when 'storno' then 'stornomeldung' else 'korrekturmeldung' end;
  v_titel := case v_art when 'abmeldung' then 'AUSTRITTSMELDUNG' when 'storno' then 'STORNO DER ANMELDUNG'
             else 'KORREKTUR EINER MELDUNG' end;

  select * into v_dv from public.dienstverhaeltnis where id = v_m.dienstverhaeltnis_id;
  select * into v_ma from public.mitarbeiter where id = v_dv.mitarbeiter_id;
  select * into v_g from public.gesellschaft where id = v_dv.gesellschaft_id;
  select * into v_st from public.standort where id = v_dv.heimstandort_id;
  select l.name into v_lv from public.lohnverrechner l where l.id = v_g.lohnverrechner_id;
  select s.sv_nummer into v_sv from public.mitarbeiter_sensibel s where s.mitarbeiter_id = v_ma.id;

  v_felder := jsonb_build_array(
    jsonb_build_array('Arbeitnehmer/in', trim(concat_ws(' ', v_ma.anrede, v_ma.vorname, v_ma.nachname))
      || coalesce(', geb. ' || to_char(v_ma.geburtsdatum, 'DD.MM.YYYY'), '')),
    jsonb_build_array('Versicherungsnummer', coalesce(v_sv, 'noch nicht bekannt')),
    jsonb_build_array('Dienstgeber', v_g.name),
    jsonb_build_array('Arbeitsort', coalesce(v_st.vertragsbezeichnung, v_st.name)),
    jsonb_build_array('Dienstantritt', to_char(v_dv.eintritt, 'DD.MM.YYYY')));

  if v_art = 'korrektur' then
    -- letzte schon übermittelte Fassung
    select a.* into v_vor from public.austritt_meldung a
    join public.dokument x on x.austritt_meldung_id = a.id and x.uebermittelt_am is not null
    where a.dienstverhaeltnis_id = v_m.dienstverhaeltnis_id and a.id <> v_m.id
    order by x.uebermittelt_am desc limit 1;
    d := case when v_vor.art = 'nicht_angetreten' then 'Nicht angetreten (Storno der Anmeldung)'
              else 'Letzter Arbeitstag ' || to_char(v_vor.letzter_arbeitstag, 'DD.MM.YYYY') || ', '
                   || app.art_text(v_m.organisation_id, v_vor.austrittsart) end;
    v_felder := v_felder || jsonb_build_array(jsonb_build_array('Bisher gemeldet', d));
    d := case when v_m.zurueckgenommen and v_m.art = 'austritt' then 'Austritt zurückgenommen, das Dienstverhältnis besteht weiter'
              when v_m.zurueckgenommen then '„Nicht angetreten“ zurückgenommen, die Anmeldung bleibt gültig'
              else 'Letzter Arbeitstag ' || to_char(v_m.letzter_arbeitstag, 'DD.MM.YYYY') || ', '
                   || app.art_text(v_m.organisation_id, v_m.austrittsart) end;
    v_felder := v_felder || jsonb_build_array(jsonb_build_array('Neu', d),
      jsonb_build_array('Grund der Korrektur', coalesce(v_m.korrektur_grund, '')));
  elsif v_art = 'abmeldung' then
    v_felder := v_felder || jsonb_build_array(
      jsonb_build_array('Letzter Arbeitstag', to_char(v_m.letzter_arbeitstag, 'DD.MM.YYYY')),
      jsonb_build_array('Art des Austritts', app.art_text(v_m.organisation_id, v_m.austrittsart)));
  else
    v_felder := v_felder || jsonb_build_array(
      jsonb_build_array('Meldung', 'Nicht angetreten, bitte die Anmeldung stornieren'),
      jsonb_build_array('Grund', coalesce(v_m.notiz, '')));
  end if;
  v_felder := v_felder || jsonb_build_array(jsonb_build_array('Bestätigt durch das Personalbüro',
    to_char(v_m.bestaetigt_am at time zone 'Europe/Vienna', 'DD.MM.YYYY')));

  v_inhalt := jsonb_build_object(
    'art', v_typ,
    'kopf', jsonb_build_object('firma', v_g.name, 'adresse', concat_ws(', ', v_g.strasse, concat_ws(' ', v_g.plz, v_g.ort))),
    'titel', v_titel,
    'untertitel', 'an ' || coalesce(v_lv, 'die Lohnverrechnung'),
    'felder', v_felder,
    'abschnitte', case when v_art = 'abmeldung' then jsonb_build_array(jsonb_build_object('titel', 'Hinweis',
      'text', 'Die Abmeldung bei der ÖGK ist binnen 7 Tagen nach Ende der Pflichtversicherung fällig. Das Ende der '
        || 'Pflichtversicherung kann vom letzten Arbeitstag abweichen, zum Beispiel bei einer Urlaubsersatzleistung.'))
      else '[]'::jsonb end,
    'unterschrift_zeilen', '[]'::jsonb);

  return jsonb_build_object(
    'organisation_id', v_m.organisation_id, 'dienstverhaeltnis_id', v_m.dienstverhaeltnis_id, 'meldung_id', v_m.id,
    'typ', v_typ, 'kategorie', case when v_m.art = 'austritt' then 'abmeldung' else 'storno' end,
    'fassung', app.fassung(v_inhalt), 'inhalt', v_inhalt,
    'dokument_id', (select x.id from public.dokument x where x.austritt_meldung_id = v_m.id and x.ersetzt_durch is null limit 1));
end $$;

-- Für die App und die Edge Function: nur Büro
create or replace function public.meldung_inhalt(p_meldung_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.ist_buero() then raise exception 'Das darf nur das Personalbüro.'; end if;
  if not exists (select 1 from public.austritt_meldung m where m.id = p_meldung_id and m.organisation_id = app.organisation_id()) then
    raise exception 'Diese Meldung wurde nicht gefunden.';
  end if;
  return app.meldung_inhalt(p_meldung_id);
end $$;

-- Nur für die Edge Function (service_role): PDF eintragen
create or replace function public.meldung_ablegen(p_user uuid, p_meldung_id uuid, p_fassung text, p_pfad text, p_hash text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_i   jsonb;
  v_m   public.austritt_meldung%rowtype;
  v_obj record;
  v_neu uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  if not app.ist_buero() then raise exception 'Das darf nur das Personalbüro.'; end if;
  -- Zeile sperren: zwei gleichzeitige Aufrufe für dieselbe Meldung laufen nacheinander
  select * into v_m from public.austritt_meldung where id = p_meldung_id and organisation_id = app.organisation_id() for update;
  if v_m.id is null then raise exception 'Diese Meldung wurde nicht gefunden.'; end if;

  -- Schon abgelegt (erneuter Versuch nach Netzfehler)? Dann dasselbe Dokument liefern.
  select x.id into v_neu from public.dokument x where x.austritt_meldung_id = v_m.id and x.ersetzt_durch is null;
  if v_neu is not null then return v_neu; end if;

  v_i := app.meldung_inhalt(v_m.id);
  if v_i ->> 'fassung' is distinct from p_fassung then
    raise exception 'Die Daten wurden geändert. Bitte noch einmal versuchen.';
  end if;
  if (storage.foldername(p_pfad))[1] <> v_m.organisation_id::text or (storage.foldername(p_pfad))[2] <> v_m.dienstverhaeltnis_id::text
     or (storage.foldername(p_pfad))[3] <> v_i ->> 'kategorie' or coalesce(p_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Der Ablageort des PDF passt nicht.';
  end if;
  select o.metadata into v_obj from storage.objects o where o.bucket_id = 'personalakte' and o.name = p_pfad;
  if v_obj is null then raise exception 'PDF nicht gefunden.'; end if;

  insert into public.dokument (organisation_id, dienstverhaeltnis_id, typ, kategorie, bezeichnung, status,
    datei_pfad, datei_hash, datei_typ, datei_groesse, hochgeladen_am, hochgeladen_von, inhalt, inhalt_hash, austritt_meldung_id)
  values (v_m.organisation_id, v_m.dienstverhaeltnis_id, v_i ->> 'typ', v_i ->> 'kategorie', case v_i ->> 'typ' when 'austrittsmeldung' then 'Austrittsmeldung'
      when 'stornomeldung' then 'Storno der Anmeldung' else 'Korrektur einer Meldung' end,
    'abgeschlossen', p_pfad, p_hash, 'application/pdf', (v_obj.metadata ->> 'size')::int, now(), p_user,
    v_i -> 'inhalt', v_i ->> 'fassung', v_m.id)
  returning id into v_neu;
  return v_neu;
end $$;

revoke execute on function app.meldung_inhalt(uuid) from public, anon, authenticated;
revoke execute on function public.meldung_inhalt(uuid) from public, anon;
grant execute on function public.meldung_inhalt(uuid) to authenticated;
revoke execute on function public.meldung_ablegen(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.meldung_ablegen(uuid, uuid, text, text, text) to service_role;
