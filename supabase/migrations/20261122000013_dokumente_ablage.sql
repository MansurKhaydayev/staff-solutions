-- Dokumente der Personalakte: Kategorien, Sichtbarkeit je Kategorie, privater Speicher.
-- Nichts wird gelöscht: Eine falsche Datei wird ersetzt, die alte bleibt sichtbar.

alter table public.dokument add column kategorie text not null default 'sonstiges'
  check (kategorie in ('anmeldung', 'onboarding', 'vereinbarung', 'abmeldung',
                       'nachweis_personendaten', 'nachweis_lohnverrechnung', 'sonstiges'));
alter table public.dokument add column vertragsstand_id uuid;
alter table public.dokument add column onboarding_unterlage_id uuid;   -- Fremdschlüssel kommt mit den Onboarding-Unterlagen
alter table public.dokument add column onboarding_ergebnis text check (onboarding_ergebnis in ('unterschrieben', 'abgelehnt'));
alter table public.dokument add column datei_typ text;
alter table public.dokument add column datei_groesse int;
alter table public.dokument add column hochgeladen_am timestamptz;
alter table public.dokument add column hochgeladen_von uuid references auth.users(id);
alter table public.dokument add column ersetzt_durch uuid;
alter table public.dokument add column ersetzt_am timestamptz;
alter table public.dokument add foreign key (vertragsstand_id, organisation_id)
  references public.vertragsstand (id, organisation_id);
alter table public.dokument add foreign key (ersetzt_durch, organisation_id)
  references public.dokument (id, organisation_id);
create index on public.dokument (vertragsstand_id, organisation_id);
create index on public.dokument (ersetzt_durch, organisation_id);
create index on public.dokument (hochgeladen_von);
create index on public.dokument (dienstverhaeltnis_id, kategorie);
create unique index dokument_datei_einmal on public.dokument (datei_pfad) where datei_pfad is not null;

update public.dokument set kategorie = case
  when typ in ('dienstzettel', 'dienstvertrag', 'einzelvereinbarung') then 'vereinbarung'
  when typ = 'anmeldebestaetigung' then 'anmeldung'
  when typ = 'onboarding' then 'onboarding'
  else 'sonstiges' end;

-- Welche Stufe braucht man zusätzlich zu "Dokumente"?
create or replace function app.zusatzstufe(p_kategorie text) returns text
language sql immutable set search_path = '' as $$
  select case p_kategorie
    when 'vereinbarung' then 'entgelt'
    when 'anmeldung' then 'lohnverrechnung'
    when 'abmeldung' then 'lohnverrechnung'
    when 'nachweis_lohnverrechnung' then 'lohnverrechnung'
    when 'nachweis_personendaten' then 'personendaten'
    else null end
$$;

-- Text -> uuid, ungültig ergibt null (für Pfade im Speicher)
create or replace function app.als_uuid(p text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

-- Darf die angemeldete Person ein Dokument dieser Kategorie zu diesem Dienstverhältnis sehen?
create or replace function app.sieht_dokument(p_kategorie text, p_dv uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.dienstverhaeltnis d
    where d.id = p_dv and d.organisation_id = app.organisation_id()
      and app.sieht('dokumente', d.heimstandort_id)
      and (app.zusatzstufe(p_kategorie) is null or app.sieht(app.zusatzstufe(p_kategorie), d.heimstandort_id)))
$$;

-- Darf sie hochladen? Büro: was es sieht. Leitungen: Onboarding für zugeordnete Studios.
create or replace function app.darf_hochladen(p_kategorie text, p_dv uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.sieht_dokument(p_kategorie, p_dv) and (
    app.ist_buero()
    or (p_kategorie = 'onboarding' and app.rolle() in ('studioleitung', 'regionalleitung')))
$$;

drop policy nach_recht on public.dokument;
create policy nach_recht on public.dokument for select to authenticated
  using (organisation_id = (select app.organisation_id()) and app.sieht_dokument(kategorie, dienstverhaeltnis_id));

-- Eine abgelegte Datei kann nicht still verändert werden (nur der Betreiber per SQL)
create or replace function app.dokument_schuetzen() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and old.datei_pfad is not null and (
       new.datei_pfad is distinct from old.datei_pfad or new.datei_hash is distinct from old.datei_hash
    or new.datei_typ is distinct from old.datei_typ or new.datei_groesse is distinct from old.datei_groesse
    or new.hochgeladen_am is distinct from old.hochgeladen_am or new.hochgeladen_von is distinct from old.hochgeladen_von
    or new.kategorie is distinct from old.kategorie or new.dienstverhaeltnis_id is distinct from old.dienstverhaeltnis_id
    or (old.ersetzt_durch is not null and new.ersetzt_durch is distinct from old.ersetzt_durch)) then
    raise exception 'Eine abgelegte Datei kann nicht geändert werden. Bitte stattdessen ersetzen.';
  end if;
  return new;
end $$;
create trigger dokument_schuetzen before update on public.dokument
  for each row execute function app.dokument_schuetzen();

-- Wird mit den Onboarding-Unterlagen befüllt (Klärung bei abgelehnter Pflichtunterlage)
create or replace function app.onboarding_nach_ablage(p_dokument uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  null;
end $$;

-- Datei aus dem Speicher als Dokument eintragen (neu, ergänzen oder ersetzen)
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

revoke execute on function app.zusatzstufe(text), app.als_uuid(text), app.sieht_dokument(text, uuid),
  app.darf_hochladen(text, uuid), public.dokument_ablegen(text, text, text, text, uuid, uuid, uuid, text)
  from public, anon;
grant execute on function app.zusatzstufe(text), app.als_uuid(text), app.sieht_dokument(text, uuid),
  app.darf_hochladen(text, uuid), public.dokument_ablegen(text, text, text, text, uuid, uuid, uuid, text)
  to authenticated;
revoke execute on function app.dokument_schuetzen(), app.onboarding_nach_ablage(uuid) from public, anon, authenticated;

-- Privater Speicher für Personalakten
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('personalakte', 'personalakte', false, 10485760, '{application/pdf,image/jpeg,image/png}')
on conflict (id) do nothing;

-- Hochladen nur in den eigenen Firmenordner und nur, wo man darf. Kein Ändern, kein Löschen.
create policy personalakte_hochladen on storage.objects for insert to authenticated
  with check (bucket_id = 'personalakte'
    and (storage.foldername(name))[1] = (select app.organisation_id())::text
    and app.darf_hochladen((storage.foldername(name))[3], app.als_uuid((storage.foldername(name))[2])));
create policy personalakte_lesen on storage.objects for select to authenticated
  using (bucket_id = 'personalakte'
    and (storage.foldername(name))[1] = (select app.organisation_id())::text
    and app.sieht_dokument((storage.foldername(name))[3], app.als_uuid((storage.foldername(name))[2])));
