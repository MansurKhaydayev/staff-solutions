-- Korrekturen aus der Gesamtprüfung der Unterschriftsmappe:
-- erneutes Absenden nach Netzfehler, gleichzeitiges Absenden, neu unterschreiben nach der Arbeitgeber-Unterschrift,
-- Dienstzettel nicht über „Ersetzen“, Unterschriften nur über die Funktionen.

-- Unterschriften entstehen nur in mappe_ablegen / arbeitgeber_ablegen (Edge Function):
-- direktes Einfügen durch angemeldete Benutzer sperren (gleiche Sperre wie bei Entgelt und Dokumenten)
create trigger nur_ueber_funktionen before insert or update on public.unterschrift
  for each row execute function app.nur_ueber_funktionen();

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
      'papier', v_dz.papier, 'fassung', v_dz.inhalt_hash);
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
        'dokument_id', o.dokument_id, 'titel', o.bezeichnung,
        'fassung', (select x.inhalt_hash from public.dokument x where x.id = o.dokument_id));
    end if;
  end loop;

  v_frueh := app.fruehester_dienstantritt(v_dv.organisation_id, app.jetzt_wien());
  return jsonb_build_object(
    'dienstverhaeltnis_id', v_dv.id,
    'organisation_id', v_dv.organisation_id,
    'ort', app.unterschrift_ort(v_dv.id),
    'name', (select m.vorname || ' ' || m.nachname from public.mitarbeiter m where m.id = v_dv.mitarbeiter_id),
    'eintritt', v_dv.eintritt,
    'frist', jsonb_build_object('fruehester', v_frueh,
      'verletzt', v_dv.eintritt < v_frueh and v_dv.dringend_grund is null
        and not exists (select 1 from public.dokument x where x.dienstverhaeltnis_id = v_dv.id and x.typ = 'dienstzettel'),
      'dringend_grund', v_dv.dringend_grund),
    'schritte', v_schritte);
end $$;

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
  -- Gleichzeitiges Absenden (zwei Geräte, Wiederholung) nacheinander abarbeiten
  perform 1 from public.dienstverhaeltnis where id = p_dienstverhaeltnis_id for update;
  if p_ergebnis not in ('unterschrieben', 'abgelehnt') or (p_art = 'dienstzettel' and p_ergebnis <> 'unterschrieben') then
    raise exception 'Der Dienstzettel kann nicht abgelehnt werden.';
  end if;

  -- Doppelt abgeschickt? Dann dasselbe Dokument liefern.
  select x.id into v_vorhanden from public.dokument x
  where x.dienstverhaeltnis_id = p_dienstverhaeltnis_id and x.inhalt_hash = p_fassung
    and x.neu_angefordert_am is null and x.ersetzt_durch is null
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

create or replace function public.arbeitgeber_inhalt(p_dokument_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.dokument%rowtype := app.dienstzettel_fuer_arbeitgeber(p_dokument_id);
  u public.unterschrift%rowtype;
  w public.dokument%rowtype;
begin
  -- Schon gegengezeichnet? Dann das fertige Dokument nennen (erneutes Absenden nach Netzfehler)
  if v.ersetzt_durch is not null then
    select * into w from public.dokument where id = v.ersetzt_durch;
    if w.status = 'abgeschlossen' and w.neu_angefordert_am is null and w.inhalt_hash = v.inhalt_hash then
      return jsonb_build_object('erledigt', true, 'dokument_id', w.id, 'fassung', w.inhalt_hash);
    end if;
  end if;
  if v.status <> 'unterschrieben' or v.ersetzt_durch is not null then
    raise exception 'Dieser Dienstzettel ist schon fertig unterschrieben.';
  end if;
  select * into u from public.unterschrift where dokument_id = v.id and rolle = 'mitarbeiter' order by zeitpunkt limit 1;
  return jsonb_build_object(
    'dokument_id', v.id,
    'organisation_id', v.organisation_id,
    'dienstverhaeltnis_id', v.dienstverhaeltnis_id,
    'fassung', v.inhalt_hash,
    'inhalt', v.inhalt,
    'mitarbeiter', jsonb_build_object('png_pfad', u.datei_pfad, 'ort', u.ort, 'datum', u.zeitpunkt),
    'arbeitgeber_ort', (select g.ort from public.dienstverhaeltnis d join public.gesellschaft g on g.id = d.gesellschaft_id
                        where d.id = v.dienstverhaeltnis_id));
end $$;

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
  -- Zeile sperren und frisch lesen: „neu unterschreiben lassen“ kann gleichzeitig kommen
  select * into v from public.dokument where id = v.id for update;
  if v.neu_angefordert_am is not null then
    raise exception 'Dieser Dienstzettel wird neu erstellt und kann nicht mehr unterschrieben werden.';
  end if;

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
  from public.unterschrift u
  where u.id = (select x.id from public.unterschrift x where x.dokument_id = v.id and x.rolle = 'mitarbeiter'
                order by x.zeitpunkt limit 1);

  insert into public.unterschrift (organisation_id, dokument_id, rolle, user_id, name, datei_hash, datei_pfad, ort)
  select v.organisation_id, v_neu, 'arbeitgeber', p_user, coalesce(au.email, 'Arbeitgeber'), p_png_hash, p_png_pfad, g.ort
  from public.dienstverhaeltnis d
  join public.gesellschaft g on g.id = d.gesellschaft_id
  left join auth.users au on au.id = p_user
  where d.id = v.dienstverhaeltnis_id;

  update public.dokument set ersetzt_durch = v_neu, ersetzt_am = now() where id = v.id;
  return v_neu;
end $$;

create or replace function public.dienstzettel_papier(p_pfad text, p_hash text, p_dienstverhaeltnis_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_neu uuid;
begin
  if not app.ist_buero() then raise exception 'Einen Papier-Dienstzettel kann nur das Personalbüro ablegen.'; end if;
  perform 1 from public.dienstverhaeltnis where id = p_dienstverhaeltnis_id and organisation_id = app.organisation_id() for update;
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

create or replace function public.dokument_ablegen(
  p_pfad                    text,
  p_hash                    text,
  p_kategorie               text,
  p_bezeichnung             text,
  p_dienstverhaeltnis_id    uuid,
  p_dokument_id             uuid default null,
  p_onboarding_unterlage_id uuid default null,
  p_onboarding_ergebnis     text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org    uuid := app.organisation_id();
  v_teile  text[] := storage.foldername(p_pfad);
  v_obj    record;
  v_alt    public.dokument%rowtype;
  v_neu    uuid;
  v_typ    text;
  v_groesse bigint;
  v_ergebnis text := p_onboarding_ergebnis;
begin
  if v_org is null then raise exception 'Dein Zugang ist keiner Firma zugeordnet.'; end if;
  if not exists (select 1 from public.dienstverhaeltnis where id = p_dienstverhaeltnis_id and organisation_id = v_org) then
    raise exception 'Diese Person wurde nicht gefunden.';
  end if;
  if p_kategorie is null or p_kategorie not in ('anmeldung', 'onboarding', 'vereinbarung', 'abmeldung',
       'nachweis_personendaten', 'nachweis_lohnverrechnung', 'sonstiges') then
    raise exception 'Bitte eine Kategorie wählen.';
  end if;
  if coalesce(array_length(v_teile, 1), 0) <> 3 or v_teile[1] <> v_org::text
     or v_teile[2] <> p_dienstverhaeltnis_id::text or v_teile[3] <> p_kategorie then
    raise exception 'Der Ablageort der Datei passt nicht zu dieser Person oder Kategorie.';
  end if;
  if not app.darf_hochladen(p_kategorie, p_dienstverhaeltnis_id) then
    raise exception 'Diese Unterlage darfst du hier nicht hochladen.';
  end if;

  -- Schon abgelegt (z. B. erneuter Versuch nach Netzfehler)? Dann denselben Eintrag liefern.
  select id into v_neu from public.dokument where datei_pfad = p_pfad;
  if v_neu is not null then return v_neu; end if;

  select o.metadata into v_obj from storage.objects o where o.bucket_id = 'personalakte' and o.name = p_pfad;
  if v_obj is null then raise exception 'Datei nicht gefunden. Bitte noch einmal hochladen.'; end if;
  v_typ := v_obj.metadata ->> 'mimetype';
  v_groesse := (v_obj.metadata ->> 'size')::bigint;
  if v_typ not in ('application/pdf', 'image/jpeg', 'image/png') then raise exception 'Nur PDF, JPG oder PNG.'; end if;
  if v_groesse > 10485760 then raise exception 'Die Datei ist größer als 10 MB.'; end if;
  if coalesce(p_hash, '') !~ '^[0-9a-f]{64}$' then raise exception 'Der Fingerabdruck der Datei fehlt.'; end if;

  if v_ergebnis is not null and v_ergebnis not in ('unterschrieben', 'abgelehnt') then
    raise exception 'Ergebnis: unterschrieben oder abgelehnt.';
  end if;
  if p_kategorie = 'onboarding' and v_ergebnis is null then v_ergebnis := 'unterschrieben'; end if;

  if p_dokument_id is not null then
    select * into v_alt from public.dokument
    where id = p_dokument_id and organisation_id = v_org and dienstverhaeltnis_id = p_dienstverhaeltnis_id;
    if v_alt.id is null then raise exception 'Das Dokument wurde nicht gefunden.'; end if;
    if v_alt.typ = 'dienstzettel' then
      raise exception 'Ein Dienstzettel wird nicht ersetzt. Bitte „Neu unterschreiben lassen“ oder einen Papier-Dienstzettel ablegen.';
    end if;
    if v_alt.kategorie <> p_kategorie then
      raise exception 'Der Ablageort der Datei passt nicht zu dieser Person oder Kategorie.';
    end if;
    if v_alt.ersetzt_durch is not null then raise exception 'Dieses Dokument wurde schon ersetzt.'; end if;

    if v_alt.datei_pfad is null then
      -- Datei fehlt noch (z. B. Nachweis): am bestehenden Eintrag ergänzen
      update public.dokument set datei_pfad = p_pfad, datei_hash = p_hash, datei_typ = v_typ,
        datei_groesse = v_groesse, hochgeladen_am = now(), hochgeladen_von = auth.uid(),
        bezeichnung = coalesce(p_bezeichnung, bezeichnung),
        onboarding_ergebnis = case when kategorie = 'onboarding' then v_ergebnis end,
        status = case when v_ergebnis = 'abgelehnt' then 'abgelehnt' else 'abgeschlossen' end
      where id = v_alt.id;
      perform app.onboarding_nach_ablage(v_alt.id);
      return v_alt.id;
    end if;

    if not app.ist_buero() then raise exception 'Ersetzen kann nur das Personalbüro.'; end if;
    insert into public.dokument (organisation_id, dienstverhaeltnis_id, vorlage_id, typ, kategorie, bezeichnung,
      vertragsstand_id, onboarding_unterlage_id, onboarding_ergebnis, status,
      datei_pfad, datei_hash, datei_typ, datei_groesse, hochgeladen_am, hochgeladen_von)
    values (v_org, p_dienstverhaeltnis_id, v_alt.vorlage_id, v_alt.typ, v_alt.kategorie,
      coalesce(p_bezeichnung, v_alt.bezeichnung), v_alt.vertragsstand_id, v_alt.onboarding_unterlage_id,
      case when v_alt.kategorie = 'onboarding' then coalesce(p_onboarding_ergebnis, v_alt.onboarding_ergebnis) end,
      case when coalesce(p_onboarding_ergebnis, v_alt.onboarding_ergebnis) = 'abgelehnt' then 'abgelehnt' else 'abgeschlossen' end,
      p_pfad, p_hash, v_typ, v_groesse, now(), auth.uid())
    returning id into v_neu;
    update public.dokument set ersetzt_durch = v_neu, ersetzt_am = now() where id = v_alt.id;
    perform app.onboarding_nach_ablage(v_neu);
    return v_neu;
  end if;

  if coalesce(trim(p_bezeichnung), '') = '' then raise exception 'Bitte eine Bezeichnung angeben.'; end if;
  insert into public.dokument (organisation_id, dienstverhaeltnis_id, typ, kategorie, bezeichnung,
    onboarding_unterlage_id, onboarding_ergebnis, status,
    datei_pfad, datei_hash, datei_typ, datei_groesse, hochgeladen_am, hochgeladen_von)
  values (v_org, p_dienstverhaeltnis_id,
    case p_kategorie when 'onboarding' then 'onboarding' when 'anmeldung' then 'anmeldebestaetigung'
                     when 'vereinbarung' then 'einzelvereinbarung' else 'sonstiges' end,
    p_kategorie, trim(p_bezeichnung), p_onboarding_unterlage_id,
    case when p_kategorie = 'onboarding' then v_ergebnis end,
    case when v_ergebnis = 'abgelehnt' then 'abgelehnt' else 'abgeschlossen' end,
    p_pfad, p_hash, v_typ, v_groesse, now(), auth.uid())
  returning id into v_neu;
  perform app.onboarding_nach_ablage(v_neu);
  return v_neu;
end $$;
