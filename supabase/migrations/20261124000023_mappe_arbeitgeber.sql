-- Unterschriftsmappe, Teil 2: Arbeitgeber-Unterschrift, neu unterschreiben lassen,
-- übermittelt/ausgehändigt vermerken, Papier-Dienstzettel, neue offene Punkte.
-- Nichts wird gelöscht: jede neue Fassung ersetzt die alte, die alte bleibt erhalten.

-- Liste „Zu unterschreiben“ (Arbeitgeber)
create or replace function public.arbeitgeber_offen()
returns table (dokument_id uuid, dienstverhaeltnis_id uuid, vorname text, nachname text, arbeitsort text, eintritt date,
               unterschrieben_am timestamptz, dringend_grund text, pdf_pfad text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.darf_arbeitgeber_unterschreiben() then
    raise exception 'Keine Berechtigung: Arbeitgeber-Unterschriften sind dir nicht freigegeben.';
  end if;
  return query
    select x.id, d.id, m.vorname, m.nachname, coalesce(s.vertragsbezeichnung, s.name), d.eintritt,
           x.hochgeladen_am, d.dringend_grund, x.datei_pfad
    from public.dokument x
    join public.dienstverhaeltnis d on d.id = x.dienstverhaeltnis_id
    join public.mitarbeiter m on m.id = d.mitarbeiter_id
    join public.standort s on s.id = d.heimstandort_id
    where x.organisation_id = app.organisation_id() and x.typ = 'dienstzettel' and x.status = 'unterschrieben'
      and x.ersetzt_durch is null and x.neu_angefordert_am is null
    order by (d.dringend_grund is null), d.eintritt, m.nachname;
end $$;

-- Prüft einen Dienstzettel für die Arbeitgeber-Unterschrift
create or replace function app.dienstzettel_fuer_arbeitgeber(p_dokument_id uuid) returns public.dokument
language plpgsql stable security definer set search_path = '' as $$
declare v public.dokument%rowtype;
begin
  if not app.darf_arbeitgeber_unterschreiben() then
    raise exception 'Keine Berechtigung: Arbeitgeber-Unterschriften sind dir nicht freigegeben.';
  end if;
  select * into v from public.dokument where id = p_dokument_id and organisation_id = app.organisation_id()
    and typ = 'dienstzettel';
  if v.id is null then raise exception 'Der Dienstzettel wurde nicht gefunden.'; end if;
  if v.neu_angefordert_am is not null then
    raise exception 'Dieser Dienstzettel wird neu erstellt und kann nicht mehr unterschrieben werden.';
  end if;
  return v;
end $$;

create or replace function public.arbeitgeber_inhalt(p_dokument_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.dokument%rowtype := app.dienstzettel_fuer_arbeitgeber(p_dokument_id);
  u public.unterschrift%rowtype;
begin
  if v.status <> 'unterschrieben' or v.ersetzt_durch is not null then
    raise exception 'Dieser Dienstzettel ist schon fertig unterschrieben.';
  end if;
  select * into u from public.unterschrift where dokument_id = v.id and rolle = 'mitarbeiter' order by zeitpunkt limit 1;
  return jsonb_build_object(
    'dokument_id', v.id,
    'fassung', v.inhalt_hash,
    'inhalt', v.inhalt,
    'mitarbeiter', jsonb_build_object('png_pfad', u.datei_pfad, 'ort', u.ort, 'datum', u.zeitpunkt),
    'arbeitgeber_ort', (select g.ort from public.dienstverhaeltnis d join public.gesellschaft g on g.id = d.gesellschaft_id
                        where d.id = v.dienstverhaeltnis_id));
end $$;

-- Eintragen nach der Arbeitgeber-Unterschrift (nur Edge Function)
create or replace function public.arbeitgeber_ablegen(
  p_user uuid, p_dokument_id uuid, p_fassung text, p_pdf_pfad text, p_pdf_hash text, p_png_pfad text, p_png_hash text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v      public.dokument%rowtype;
  v_org  text;
  v_obj  record;
  v_neu  uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  v := app.dienstzettel_fuer_arbeitgeber(p_dokument_id);  -- Recht, Organisation, nicht neu angefordert

  -- Doppelt abgeschickt? Dann das fertige Dokument liefern.
  if v.ersetzt_durch is not null then
    select x.id into v_neu from public.dokument x
    where x.id = v.ersetzt_durch and x.status = 'abgeschlossen' and x.inhalt_hash = p_fassung;
    if v_neu is not null then return v_neu; end if;
  end if;
  if v.status <> 'unterschrieben' or v.ersetzt_durch is not null then
    raise exception 'Dieser Dienstzettel ist schon fertig unterschrieben.';
  end if;
  if v.inhalt_hash is distinct from p_fassung then
    raise exception 'Die Daten wurden geändert. Bitte die Liste neu öffnen.';
  end if;

  v_org := v.organisation_id::text;
  if (storage.foldername(p_pdf_pfad))[1] <> v_org or (storage.foldername(p_pdf_pfad))[2] <> v.dienstverhaeltnis_id::text
     or (storage.foldername(p_pdf_pfad))[3] <> 'vereinbarung' or coalesce(p_pdf_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Der Ablageort des PDF passt nicht.';
  end if;
  select o.metadata into v_obj from storage.objects o where o.bucket_id = 'personalakte' and o.name = p_pdf_pfad;
  if v_obj is null then raise exception 'PDF nicht gefunden.'; end if;
  if (storage.foldername(p_png_pfad))[1] <> v_org or (storage.foldername(p_png_pfad))[2] <> v.dienstverhaeltnis_id::text
     or (storage.foldername(p_png_pfad))[3] <> 'unterschrift' or coalesce(p_png_hash, '') !~ '^[0-9a-f]{64}$'
     or not exists (select 1 from storage.objects o where o.bucket_id = 'personalakte' and o.name = p_png_pfad) then
    raise exception 'Die Unterschrift wurde nicht gefunden.';
  end if;

  insert into public.dokument (organisation_id, dienstverhaeltnis_id, typ, kategorie, bezeichnung, status,
    datei_pfad, datei_hash, datei_typ, datei_groesse, hochgeladen_am, hochgeladen_von, inhalt, inhalt_hash)
  values (v.organisation_id, v.dienstverhaeltnis_id, 'dienstzettel', 'vereinbarung', v.bezeichnung, 'abgeschlossen',
    p_pdf_pfad, p_pdf_hash, 'application/pdf', (v_obj.metadata ->> 'size')::int, now(), p_user, v.inhalt, v.inhalt_hash)
  returning id into v_neu;

  -- Mitarbeiter-Unterschrift auf das fertige Dokument übernehmen (das Original bleibt am ersten Dokument)
  insert into public.unterschrift (organisation_id, dokument_id, rolle, user_id, name, datei_hash, datei_pfad, ort, zeitpunkt)
  select u.organisation_id, v_neu, u.rolle, u.user_id, u.name, u.datei_hash, u.datei_pfad, u.ort, u.zeitpunkt
  from public.unterschrift u where u.dokument_id = v.id;

  insert into public.unterschrift (organisation_id, dokument_id, rolle, user_id, name, datei_hash, datei_pfad, ort)
  select v.organisation_id, v_neu, 'arbeitgeber', p_user, coalesce(au.email, 'Arbeitgeber'), p_png_hash, p_png_pfad, g.ort
  from public.dienstverhaeltnis d
  join public.gesellschaft g on g.id = d.gesellschaft_id
  left join auth.users au on au.id = p_user
  where d.id = v.dienstverhaeltnis_id;

  update public.dokument set ersetzt_durch = v_neu, ersetzt_am = now() where id = v.id;
  return v_neu;
end $$;

-- Neu unterschreiben lassen (z. B. Fehler im Dienstzettel)
create or replace function public.dienstzettel_neu_anfordern(p_dokument_id uuid, p_grund text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.dokument%rowtype;
begin
  if not app.ist_buero() then raise exception 'Neu unterschreiben lassen kann nur das Personalbüro.'; end if;
  if coalesce(trim(p_grund), '') = '' then raise exception 'Bitte einen Grund angeben.'; end if;
  select * into v from public.dokument where id = p_dokument_id and organisation_id = app.organisation_id()
    and typ = 'dienstzettel' for update;
  if v.id is null then raise exception 'Der Dienstzettel wurde nicht gefunden.'; end if;
  if v.ersetzt_durch is not null or v.neu_angefordert_am is not null then
    raise exception 'Dieser Dienstzettel ist nicht mehr gültig.';
  end if;
  update public.dokument set neu_angefordert_am = now(), neu_angefordert_grund = trim(p_grund),
    status = case when status = 'unterschrieben' then 'abgelehnt' else status end
  where id = v.id;
end $$;

-- Übermittelt an den Lohnverrechner / an den Mitarbeiter ausgehändigt
create or replace function public.dienstzettel_vermerken(p_dokument_id uuid, p_was text, p_art text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.dokument%rowtype;
begin
  if not app.ist_buero() then raise exception 'Das kann nur das Personalbüro vermerken.'; end if;
  if p_was not in ('uebermittelt', 'ausgehaendigt') then raise exception 'Unbekannter Vermerk.'; end if;
  if p_was = 'ausgehaendigt' and coalesce(p_art, '') not in ('ausdruck', 'email') then
    raise exception 'Bitte Ausdruck oder E-Mail wählen.';
  end if;
  select * into v from public.dokument where id = p_dokument_id and organisation_id = app.organisation_id()
    and typ = 'dienstzettel' for update;
  if v.id is null then raise exception 'Der Dienstzettel wurde nicht gefunden.'; end if;
  if v.status <> 'abgeschlossen' or v.ersetzt_durch is not null or v.neu_angefordert_am is not null then
    raise exception 'Der Dienstzettel ist noch nicht abgeschlossen.';
  end if;
  -- Ein erster Vermerk wird nie überschrieben
  if p_was = 'uebermittelt' then
    update public.dokument set uebermittelt_am = now(), uebermittelt_von = auth.uid()
    where id = v.id and uebermittelt_am is null;
  else
    update public.dokument set ausgehaendigt_am = now(), ausgehaendigt_art = p_art
    where id = v.id and ausgehaendigt_am is null;
  end if;
end $$;

-- Papier-Dienstzettel (Notlösung, z. B. iPad defekt)
create or replace function public.dienstzettel_papier(p_pfad text, p_hash text, p_dienstverhaeltnis_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_neu uuid;
begin
  if not app.ist_buero() then raise exception 'Einen Papier-Dienstzettel kann nur das Personalbüro ablegen.'; end if;
  v_neu := public.dokument_ablegen(p_pfad, p_hash, 'vereinbarung', 'Dienstzettel (Papier)', p_dienstverhaeltnis_id);
  if exists (select 1 from public.dokument where id = v_neu and typ = 'dienstzettel') then return v_neu; end if;
  if (app.aktueller_dienstzettel(p_dienstverhaeltnis_id)).id is not null then
    raise exception 'Es gibt schon einen gültigen Dienstzettel.';
  end if;
  update public.dokument set typ = 'dienstzettel', papier = true where id = v_neu;
  update public.dokument set ersetzt_durch = v_neu, ersetzt_am = now()
  where dienstverhaeltnis_id = p_dienstverhaeltnis_id and typ = 'dienstzettel' and id <> v_neu
    and ersetzt_durch is null and neu_angefordert_am is not null;
  return v_neu;
end $$;

-- Doppelt-abgeschickt-Prüfung: zum Neu-Unterschreiben angeforderte Fassungen zählen nicht
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
    and x.neu_angefordert_am is null
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


-- Offene Punkte: neu mit Dienstzettel, Arbeitgeber-Unterschrift, Übermittlung, dringende Anmeldung
create or replace function public.offene_punkte()
returns table (dienstverhaeltnis_id uuid, vorname text, nachname text, standort_id uuid, art text, beschreibung text, datum date)
language sql stable security definer set search_path = '' as $$
  with aktiv as (
    select d.id, d.mitarbeiter_id, d.heimstandort_id, d.eintritt, d.dringend_grund, m.vorname, m.nachname
    from public.dienstverhaeltnis d
    join public.mitarbeiter m on m.id = d.mitarbeiter_id
    where d.organisation_id = app.organisation_id()
      and (d.austritt is null or d.austritt >= current_date)
      and app.in_reichweite(d.id)
  ),
  -- erst filtern, dann die Checkliste holen (onboarding_stand wirft ohne Recht einen Fehler)
  mit_dokumenten as materialized (
    select * from aktiv where app.sieht('dokumente', heimstandort_id)
  )
  -- Onboarding fehlt / Klärung offen
  select a.id, a.vorname, a.nachname, a.heimstandort_id,
         case o.status when 'fehlt' then 'onboarding' else 'klaerung' end, o.bezeichnung, null::date
  from mit_dokumenten a
  cross join lateral public.onboarding_stand(a.id) o
  where o.status in ('fehlt', 'klaerung')
  union all
  -- Stundenanpassung ohne Nachweis
  select a.id, a.vorname, a.nachname, a.heimstandort_id, 'nachweis_stunden', 'Stundenanpassung', t
  from aktiv a
  cross join lateral app.staende_ohne_nachweis(a.id) t
  where app.sieht('personendaten', a.heimstandort_id)
  union all
  -- Stammdatenänderung ohne Nachweis
  select a.id, a.vorname, a.nachname, a.heimstandort_id, 'nachweis_stammdaten',
         string_agg(case s.feld when 'anrede' then 'Anrede' when 'vorname' then 'Vorname' when 'nachname' then 'Nachname'
           when 'geburtsdatum' then 'Geburtsdatum' when 'strasse' then 'Straße' when 'plz' then 'PLZ' when 'ort' then 'Ort'
           when 'telefon' then 'Telefon' when 'email' then 'E-Mail' when 'sv_nummer' then 'Versicherungsnummer'
           when 'iban' then 'IBAN' when 'bic' then 'BIC' else 'Staatsangehörigkeit' end, ', ' order by s.feld),
         min(s.gueltig_ab)
  from aktiv a
  join public.dokument x on x.dienstverhaeltnis_id = a.id and x.kategorie in ('nachweis_personendaten', 'nachweis_lohnverrechnung')
    and x.datei_pfad is null and x.ersetzt_durch is null
  join public.stammdaten_aenderung s on s.dokument_id = x.id
  where app.sieht('dokumente', a.heimstandort_id) and app.sieht(s.stufe, a.heimstandort_id)
  group by a.id, a.vorname, a.nachname, a.heimstandort_id, x.id
  union all
  -- Versicherungsnummer nachreichen
  select a.id, a.vorname, a.nachname, a.heimstandort_id, 'sv_nummer', 'Versicherungsnummer nachreichen', null::date
  from aktiv a
  join public.mitarbeiter_sensibel s on s.mitarbeiter_id = a.mitarbeiter_id and s.sv_nummer_nachreichen
  where app.sieht('lohnverrechnung', a.heimstandort_id)
  union all
  -- Dienstzettel fehlt (oder soll neu unterschrieben werden)
  select a.id, a.vorname, a.nachname, a.heimstandort_id, 'dienstzettel',
         case when exists (select 1 from public.dokument x where x.dienstverhaeltnis_id = a.id and x.typ = 'dienstzettel'
                             and x.neu_angefordert_am is not null and x.ersetzt_durch is null)
              then 'Dienstzettel neu unterschreiben lassen' else 'Dienstzettel unterschreiben lassen' end,
         a.eintritt
  from mit_dokumenten a
  where (app.aktueller_dienstzettel(a.id)).id is null
  union all
  -- Arbeitgeber-Unterschrift fehlt
  select a.id, a.vorname, a.nachname, a.heimstandort_id, 'arbeitgeber', 'Arbeitgeber-Unterschrift fehlt', a.eintritt
  from aktiv a
  join public.dokument x on x.dienstverhaeltnis_id = a.id and x.typ = 'dienstzettel' and x.status = 'unterschrieben'
    and x.ersetzt_durch is null and x.neu_angefordert_am is null
  where app.darf_arbeitgeber_unterschreiben()
  union all
  -- Fertigen Dienstzettel an den Lohnverrechner übermitteln
  select a.id, a.vorname, a.nachname, a.heimstandort_id, 'uebermittlung', 'Dienstzettel an Lohnverrechner übermitteln', a.eintritt
  from aktiv a
  join public.dokument x on x.dienstverhaeltnis_id = a.id and x.typ = 'dienstzettel' and x.status = 'abgeschlossen'
    and x.ersetzt_durch is null and x.neu_angefordert_am is null and x.uebermittelt_am is null
  where app.ist_buero()
  union all
  -- Dringende Anmeldung, noch keine Anmeldebestätigung
  select a.id, a.vorname, a.nachname, a.heimstandort_id, 'dringend', 'Dringende Anmeldung: ' || a.dringend_grund, a.eintritt
  from aktiv a
  where app.ist_buero() and a.dringend_grund is not null and not app.angemeldet(a.id)
$$;
revoke execute on function app.dienstzettel_fuer_arbeitgeber(uuid) from public, anon, authenticated;
revoke execute on function public.arbeitgeber_offen(), public.arbeitgeber_inhalt(uuid), public.dienstzettel_neu_anfordern(uuid, text),
  public.dienstzettel_vermerken(uuid, text, text), public.dienstzettel_papier(text, text, uuid) from public, anon;
grant execute on function public.arbeitgeber_offen(), public.arbeitgeber_inhalt(uuid), public.dienstzettel_neu_anfordern(uuid, text),
  public.dienstzettel_vermerken(uuid, text, text), public.dienstzettel_papier(text, text, uuid) to authenticated;
grant execute on function public.arbeitgeber_inhalt(uuid) to service_role;
revoke execute on function public.arbeitgeber_ablegen(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.arbeitgeber_ablegen(uuid, uuid, text, text, text, text, text) to service_role;
revoke execute on function public.offene_punkte() from public, anon;
grant execute on function public.offene_punkte() to authenticated;
