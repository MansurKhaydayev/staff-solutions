-- Unterschriftsmappe, Teil 3: Inhalt der Mappe und Ablage der Mitarbeiter-Unterschrift.
-- Der Inhalt jedes Dokuments wird hier zusammengestellt; die Edge Function „mappe“ macht daraus das PDF.
-- Eintragen darf nur die Edge Function (service_role); sie gibt die handelnde Person mit.

alter table public.dokument add column inhalt jsonb;
alter table public.dokument add column inhalt_hash text;
alter table public.dokument add column papier boolean not null default false;
alter table public.dokument add column neu_angefordert_am timestamptz;
alter table public.dokument add column neu_angefordert_grund text;
alter table public.dokument add column uebermittelt_am timestamptz;
alter table public.dokument add column uebermittelt_von uuid references auth.users(id);
alter table public.dokument add column ausgehaendigt_am timestamptz;
alter table public.dokument add column ausgehaendigt_art text check (ausgehaendigt_art in ('ausdruck', 'email'));
create index on public.dokument (uebermittelt_von);
create index on public.dokument (dienstverhaeltnis_id, typ);

alter table public.unterschrift add column datei_pfad text;

-- Speicherkategorie „unterschrift“ (Bilder der Unterschriften): sichtbar wie Vereinbarungen
create or replace function app.zusatzstufe(p_kategorie text) returns text
language sql immutable set search_path = '' as $$
  select case p_kategorie
    when 'vereinbarung' then 'entgelt'
    when 'unterschrift' then 'entgelt'
    when 'anmeldung' then 'lohnverrechnung'
    when 'abmeldung' then 'lohnverrechnung'
    when 'nachweis_lohnverrechnung' then 'lohnverrechnung'
    when 'nachweis_personendaten' then 'personendaten'
    else null end
$$;

-- Ort für „Ort, Datum“ bei der Unterschrift: Studio-Ort bzw. beim Büro die Vertragsbezeichnung
create or replace function app.unterschrift_ort(p_dv uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when s.art = 'buero' then coalesce(s.vertragsbezeichnung, s.name) else s.name end
  from public.dienstverhaeltnis d join public.standort s on s.id = d.heimstandort_id where d.id = p_dv
$$;

-- Inhalt des Dienstzettels (Form wie pdf.js erwartet)
create or replace function app.dienstzettel_inhalt(p_dv uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_dv  public.dienstverhaeltnis%rowtype;
  v_ma  public.mitarbeiter%rowtype;
  v_st  public.standort%rowtype;
  v_g   public.gesellschaft%rowtype;
  v_org public.organisation%rowtype;
  v_s   public.vertragsstand%rowtype;
  v_e   public.entgelt%rowtype;
  v_z   numeric;
  v_adresse text;
begin
  select * into v_dv from public.dienstverhaeltnis where id = p_dv;
  select * into v_ma from public.mitarbeiter where id = v_dv.mitarbeiter_id;
  select * into v_st from public.standort where id = v_dv.heimstandort_id;
  select * into v_g from public.gesellschaft where id = v_dv.gesellschaft_id;
  select * into v_org from public.organisation where id = v_dv.organisation_id;
  v_s := app.stand_am(v_dv.id, v_dv.eintritt);
  select * into v_e from public.entgelt where dienstverhaeltnis_id = v_dv.id and storniert_am is null and gueltig_ab <= v_dv.eintritt
    order by gueltig_ab desc limit 1;
  select netto into v_z from public.zulage where dienstverhaeltnis_id = v_dv.id and art = 'Leiterzulage' order by gueltig_ab limit 1;
  v_adresse := concat_ws(', ', v_g.strasse, concat_ws(' ', v_g.plz, v_g.ort));

  return jsonb_build_object(
    'art', 'dienstzettel',
    'kopf', jsonb_build_object('firma', v_g.name, 'adresse', v_adresse),
    'titel', 'DIENSTZETTEL',
    'untertitel', 'gemäß § 2 Arbeitsvertragsrechts-Anpassungsgesetz (AVRAG)',
    'felder', jsonb_build_array(
      jsonb_build_array('Arbeitgeber', concat_ws(', ', v_g.name, v_adresse)),
      jsonb_build_array('Arbeitnehmer/in', concat_ws(' ', v_ma.anrede, v_ma.vorname, v_ma.nachname)
        || ', geboren am ' || to_char(v_ma.geburtsdatum, 'DD.MM.YYYY') || E'\n'
        || concat_ws(', ', v_ma.strasse, concat_ws(' ', v_ma.plz, v_ma.ort))),
      jsonb_build_array('Beginn', to_char(v_dv.eintritt, 'DD.MM.YYYY')),
      jsonb_build_array('Probezeit', v_org.probezeit_monate || case when v_org.probezeit_monate = 1 then ' Monat' else ' Monate' end),
      jsonb_build_array('Befristung', case when v_dv.befristet_bis is null then 'unbefristet'
        else 'befristet bis ' || to_char(v_dv.befristet_bis, 'DD.MM.YYYY') end),
      jsonb_build_array('Arbeitsort', coalesce(v_st.vertragsbezeichnung, v_st.name)),
      jsonb_build_array('Tätigkeit', (select f.name from public.funktion f where f.id = v_dv.funktion_id)),
      jsonb_build_array('Arbeitszeit', case v_s.beschaeftigungsart when 'vollzeit' then 'Vollzeit'
        when 'teilzeit' then 'Teilzeit' else 'Geringfügig' end || ', ' || app.zahl(v_s.wochenstunden)
        || ' Stunden pro Woche' || coalesce(', verteilt auf ' || v_s.arbeitstage_woche || ' Tage', '')),
      jsonb_build_array('Entgelt', case when v_e.brutto is not null then '€ ' || app.betrag(v_e.brutto) || ' brutto monatlich'
        else '€ ' || app.betrag(v_e.netto) || ' netto monatlich (Brutto wird vom Lohnverrechner ermittelt)' end),
      jsonb_build_array('Sonderzahlungen', case when v_dv.sonderzahlung
        then '13. und 14. Gehalt laut gesonderter Vereinbarung' else 'keine gesonderte Vereinbarung' end))
      || case when v_z is null then '[]'::jsonb
         else jsonb_build_array(jsonb_build_array('Leiterzulage', '€ ' || app.betrag(v_z) || ' netto monatlich laut gesonderter Vereinbarung')) end,
    'abschnitte', coalesce((
      select jsonb_agg(jsonb_build_object('titel', t.titel, 'text', t.text) order by t.reihenfolge, t.schluessel)
      from (select distinct on (b.schluessel) b.* from public.textbaustein b
            where b.organisation_id = v_dv.organisation_id and b.aktiv
              and (b.gesellschaft_id is null or b.gesellschaft_id = v_dv.gesellschaft_id)
            order by b.schluessel, b.gesellschaft_id nulls last) t), '[]'),
    'unterschrift_zeilen', jsonb_build_array(
      jsonb_build_object('rolle', 'mitarbeiter', 'beschriftung', 'Arbeitnehmer/in: ' || v_ma.vorname || ' ' || v_ma.nachname),
      jsonb_build_object('rolle', 'arbeitgeber', 'beschriftung', 'Arbeitgeber: ' || v_g.name)));
end $$;

-- Inhalt einer Onboarding-Unterlage
create or replace function app.onboarding_inhalt(p_dv uuid, p_unterlage uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'art', 'onboarding',
    'kopf', jsonb_build_object('firma', g.name, 'adresse', concat_ws(', ', g.strasse, concat_ws(' ', g.plz, g.ort))),
    'titel', u.bezeichnung,
    'untertitel', null,
    'felder', jsonb_build_array(
      jsonb_build_array('Name', m.vorname || ' ' || m.nachname),
      jsonb_build_array('Arbeitsort', coalesce(s.vertragsbezeichnung, s.name)),
      jsonb_build_array('Beginn', to_char(d.eintritt, 'DD.MM.YYYY'))),
    'abschnitte', jsonb_build_array(jsonb_build_object('titel', null, 'text', u.text)),
    'unterschrift_zeilen', jsonb_build_array(
      jsonb_build_object('rolle', 'mitarbeiter', 'beschriftung', 'Mitarbeiter/in: ' || m.vorname || ' ' || m.nachname)))
  from public.dienstverhaeltnis d
  join public.mitarbeiter m on m.id = d.mitarbeiter_id
  join public.standort s on s.id = d.heimstandort_id
  join public.gesellschaft g on g.id = d.gesellschaft_id
  join public.onboarding_unterlage u on u.id = p_unterlage and u.organisation_id = d.organisation_id
  where d.id = p_dv
$$;

create or replace function app.fassung(p_inhalt jsonb) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p_inhalt::text, 'UTF8')), 'hex')
$$;

-- Gültiger (unterschriebener, nicht ersetzter, nicht neu angeforderter) Dienstzettel
create or replace function app.aktueller_dienstzettel(p_dv uuid) returns public.dokument
language sql stable security definer set search_path = '' as $$
  select x.* from public.dokument x
  where x.dienstverhaeltnis_id = p_dv and x.typ = 'dienstzettel' and x.ersetzt_durch is null
    and x.neu_angefordert_am is null and x.status in ('unterschrieben', 'abgeschlossen')
  order by x.created_at desc limit 1
$$;

create or replace function public.mappe_inhalt(p_dienstverhaeltnis_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_dv     public.dienstverhaeltnis%rowtype;
  v_dz     public.dokument%rowtype;
  v_inhalt jsonb;
  v_schritte jsonb := '[]';
  v_frueh  date;
  o        record;
begin
  select * into v_dv from public.dienstverhaeltnis where id = p_dienstverhaeltnis_id and organisation_id = app.organisation_id();
  if v_dv.id is null or not app.in_reichweite(v_dv.id)
     or not (app.ist_buero() or (app.rolle() in ('studioleitung', 'regionalleitung') and app.sieht('dokumente', v_dv.heimstandort_id))) then
    raise exception 'Keine Berechtigung für diese Mappe.';
  end if;

  v_dz := app.aktueller_dienstzettel(v_dv.id);
  if v_dz.id is not null then
    v_schritte := v_schritte || jsonb_build_object('art', 'dienstzettel', 'status', v_dz.status, 'dokument_id', v_dz.id,
      'papier', v_dz.papier);
  else
    v_inhalt := app.dienstzettel_inhalt(v_dv.id);
    v_schritte := v_schritte || jsonb_build_object('art', 'dienstzettel', 'status', 'offen',
      'fassung', app.fassung(v_inhalt), 'inhalt', v_inhalt);
  end if;

  for o in select * from public.onboarding_stand(v_dv.id) loop
    if o.status = 'fehlt' then
      v_inhalt := app.onboarding_inhalt(v_dv.id, o.unterlage_id);
      v_schritte := v_schritte || jsonb_build_object('art', 'onboarding', 'unterlage_id', o.unterlage_id, 'status', 'offen',
        'pflicht', o.pflicht, 'fassung', app.fassung(v_inhalt), 'inhalt', v_inhalt);
    else
      v_schritte := v_schritte || jsonb_build_object('art', 'onboarding', 'unterlage_id', o.unterlage_id,
        'status', case when o.status = 'erledigt' then 'abgeschlossen' else 'abgelehnt' end,
        'dokument_id', o.dokument_id, 'titel', o.bezeichnung);
    end if;
  end loop;

  v_frueh := app.fruehester_dienstantritt(v_dv.organisation_id, app.jetzt_wien());
  return jsonb_build_object(
    'dienstverhaeltnis_id', v_dv.id,
    'name', (select m.vorname || ' ' || m.nachname from public.mitarbeiter m where m.id = v_dv.mitarbeiter_id),
    'eintritt', v_dv.eintritt,
    'frist', jsonb_build_object('fruehester', v_frueh,
      'verletzt', v_dv.eintritt < v_frueh and v_dv.dringend_grund is null
        and not exists (select 1 from public.dokument x where x.dienstverhaeltnis_id = v_dv.id and x.typ = 'dienstzettel'),
      'dringend_grund', v_dv.dringend_grund),
    'schritte', v_schritte);
end $$;

-- Eintragen nach dem Unterschreiben (nur Edge Function)
create or replace function public.mappe_ablegen(
  p_user uuid, p_dienstverhaeltnis_id uuid, p_art text, p_unterlage_id uuid, p_fassung text, p_ergebnis text,
  p_pdf_pfad text, p_pdf_hash text, p_png_pfad text, p_png_hash text, p_dringend_grund text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_vorhanden uuid;
  v_mappe  jsonb;
  v_schritt jsonb;
  v_dv     public.dienstverhaeltnis%rowtype;
  v_org    text;
  v_kat    text := case when p_art = 'dienstzettel' then 'vereinbarung' else 'onboarding' end;
  v_obj    record;
  v_neu    uuid;
  v_frueh  date;
begin
  -- Ab hier handelt die Person, deren Zugang die Edge Function geprüft hat
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);

  if p_art not in ('dienstzettel', 'onboarding') then raise exception 'Unbekannte Unterlage.'; end if;
  if p_ergebnis not in ('unterschrieben', 'abgelehnt') or (p_art = 'dienstzettel' and p_ergebnis <> 'unterschrieben') then
    raise exception 'Der Dienstzettel kann nicht abgelehnt werden.';
  end if;

  -- Doppelt abgeschickt? Dann dasselbe Dokument liefern.
  select x.id into v_vorhanden from public.dokument x
  where x.dienstverhaeltnis_id = p_dienstverhaeltnis_id and x.inhalt_hash = p_fassung
    and ((p_art = 'dienstzettel' and x.typ = 'dienstzettel') or x.onboarding_unterlage_id = p_unterlage_id);
  if v_vorhanden is not null then return v_vorhanden; end if;

  v_mappe := public.mappe_inhalt(p_dienstverhaeltnis_id);  -- prüft auch die Rechte
  select s.value into v_schritt from jsonb_array_elements(v_mappe -> 'schritte') as s
  where s.value ->> 'art' = p_art and (p_art = 'dienstzettel' or s.value ->> 'unterlage_id' = p_unterlage_id::text);
  if v_schritt is null then raise exception 'Diese Unterlage gehört nicht zu dieser Person.'; end if;
  if v_schritt ->> 'status' <> 'offen' then raise exception 'Diese Unterlage ist schon erledigt.'; end if;
  if v_schritt ->> 'fassung' is distinct from p_fassung then
    raise exception 'Die Daten wurden geändert. Bitte die Mappe neu öffnen.';
  end if;

  select * into v_dv from public.dienstverhaeltnis where id = p_dienstverhaeltnis_id;
  v_org := v_dv.organisation_id::text;

  -- Fristregel bei der ersten Unterschrift des Dienstzettels
  if p_art = 'dienstzettel' and v_dv.dringend_grund is null
     and not exists (select 1 from public.dokument x where x.dienstverhaeltnis_id = v_dv.id and x.typ = 'dienstzettel') then
    v_frueh := app.fruehester_dienstantritt(v_dv.organisation_id, app.jetzt_wien());
    if v_dv.eintritt < v_frueh then
      if coalesce(trim(p_dringend_grund), '') = '' then raise exception 'FRIST: %', app.frist_meldung(v_frueh); end if;
      update public.dienstverhaeltnis set dringend_grund = trim(p_dringend_grund), dringend_von = p_user, dringend_am = now()
      where id = v_dv.id;
    end if;
  end if;

  -- Dateien liegen im Speicher, am richtigen Ort
  if (storage.foldername(p_pdf_pfad))[1] <> v_org or (storage.foldername(p_pdf_pfad))[2] <> v_dv.id::text
     or (storage.foldername(p_pdf_pfad))[3] <> v_kat or coalesce(p_pdf_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Der Ablageort des PDF passt nicht.';
  end if;
  select o.metadata into v_obj from storage.objects o where o.bucket_id = 'personalakte' and o.name = p_pdf_pfad;
  if v_obj is null then raise exception 'PDF nicht gefunden.'; end if;
  if p_ergebnis = 'unterschrieben' then
    if (storage.foldername(p_png_pfad))[1] <> v_org or (storage.foldername(p_png_pfad))[2] <> v_dv.id::text
       or (storage.foldername(p_png_pfad))[3] <> 'unterschrift' or coalesce(p_png_hash, '') !~ '^[0-9a-f]{64}$'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'personalakte' and o.name = p_png_pfad) then
      raise exception 'Die Unterschrift wurde nicht gefunden.';
    end if;
  end if;

  insert into public.dokument (organisation_id, dienstverhaeltnis_id, typ, kategorie, bezeichnung, status,
    onboarding_unterlage_id, onboarding_ergebnis, datei_pfad, datei_hash, datei_typ, datei_groesse,
    hochgeladen_am, hochgeladen_von, inhalt, inhalt_hash)
  values (v_dv.organisation_id, v_dv.id, p_art, v_kat,
    case when p_art = 'dienstzettel' then 'Dienstzettel' else v_schritt -> 'inhalt' ->> 'titel' end,
    case when p_art = 'dienstzettel' then 'unterschrieben' when p_ergebnis = 'abgelehnt' then 'abgelehnt' else 'abgeschlossen' end,
    p_unterlage_id, case when p_art = 'onboarding' then p_ergebnis end,
    p_pdf_pfad, p_pdf_hash, 'application/pdf', (v_obj.metadata ->> 'size')::int, now(), p_user,
    v_schritt -> 'inhalt', p_fassung)
  returning id into v_neu;

  if p_ergebnis = 'unterschrieben' then
    insert into public.unterschrift (organisation_id, dokument_id, rolle, user_id, name, datei_hash, datei_pfad, ort)
    select v_dv.organisation_id, v_neu, 'mitarbeiter', p_user, m.vorname || ' ' || m.nachname, p_png_hash, p_png_pfad,
           app.unterschrift_ort(v_dv.id)
    from public.mitarbeiter m where m.id = v_dv.mitarbeiter_id;
  end if;

  -- Frühere, zum Neu-Unterschreiben angeforderte Fassung wird ersetzt
  if p_art = 'dienstzettel' then
    update public.dokument set ersetzt_durch = v_neu, ersetzt_am = now()
    where dienstverhaeltnis_id = v_dv.id and typ = 'dienstzettel' and id <> v_neu and ersetzt_durch is null
      and neu_angefordert_am is not null;
  end if;

  perform app.onboarding_nach_ablage(v_neu);
  return v_neu;
end $$;

revoke execute on function app.unterschrift_ort(uuid), app.dienstzettel_inhalt(uuid), app.onboarding_inhalt(uuid, uuid),
  app.aktueller_dienstzettel(uuid) from public, anon, authenticated;
revoke execute on function public.mappe_inhalt(uuid) from public, anon;
grant execute on function public.mappe_inhalt(uuid) to authenticated, service_role;
revoke execute on function public.mappe_ablegen(uuid, uuid, text, uuid, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.mappe_ablegen(uuid, uuid, text, uuid, text, text, text, text, text, text, text) to service_role;
