-- Storno-Bestätigung hochladen: dokument_ablegen kennt jetzt die Kategorie „storno“
-- (sonst bliebe „Storno ausständig“ stehen). Sonst unverändert gegenüber Migration 025.
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
  if p_kategorie is null or p_kategorie not in ('anmeldung', 'onboarding', 'vereinbarung', 'abmeldung', 'storno',
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
