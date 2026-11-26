-- Austritt: Funde aus der unabhängigen Prüfung
-- 1. Art, Notiz und Gründe nur noch über austritt_verlauf (dort nach Personendaten gefiltert).
--    Direkt aus der Tabelle liest nur noch das Personalbüro.
-- 2. Eine neue Abmeldung nach einer übermittelten Rücknahme ist wieder eine Abmeldung, keine Korrektur.
-- 3. „Gesendet? Ja“ vermerkt nur PDFs der aktuellen Fassung; gezählt wird, was wirklich vermerkt wurde.
-- 4. Bestätigungen (Abmeldung, Storno) zählen nur, wenn sie zur aktuellen Meldung gehören (nach der Meldung hochgeladen).
-- 5. Storno nötig: gleiche Regel für Status und Übermittlungsliste.
-- 6. Eine noch nicht bestätigte Meldung lässt sich nur zurücknehmen; ändern geht beim Bestätigen.

alter policy nach_recht on public.austritt_meldung
  using (organisation_id = (select app.organisation_id()) and (select app.ist_buero()));

-- Storno nötig: schon angemeldet (Bestätigung hochgeladen) oder Anmeldung schon beim Lohnverrechner
create or replace function app.storno_noetig(p_dv uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.bestaetigung_liegt_vor(p_dv, 'anmeldung')
      or exists (select 1 from public.dokument x where x.dienstverhaeltnis_id = p_dv
                 and x.typ = 'dienstzettel' and x.uebermittelt_am is not null)
$$;

-- hochgeladene Bestätigung (nicht das selbst erzeugte Meldungs-PDF). Abmelde- und Storno-Bestätigungen
-- zählen nur, wenn sie nach der aktuellen Meldung hochgeladen wurden (nicht die einer zurückgenommenen).
create or replace function app.bestaetigung_liegt_vor(p_dv uuid, p_kategorie text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.dokument x where x.dienstverhaeltnis_id = p_dv and x.kategorie = p_kategorie
                 and x.datei_pfad is not null and x.ersetzt_durch is null
                 and x.typ not in ('austrittsmeldung', 'stornomeldung', 'korrekturmeldung')
                 and (p_kategorie not in ('abmeldung', 'storno')
                      or coalesce(x.hochgeladen_am, x.created_at)
                         >= coalesce((app.aktuelle_meldung(p_dv)).gemeldet_am, '-infinity'::timestamptz)))
$$;

create or replace function app.dv_status(p_dv uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  m public.austritt_meldung;
begin
  m := app.aktuelle_meldung(p_dv);
  if m.id is null then return 'aktiv'; end if;
  if m.art = 'austritt' then
    if m.bestaetigt_am is null then return 'austritt_gemeldet'; end if;
    if app.bestaetigung_liegt_vor(p_dv, 'abmeldung') then return 'abgemeldet'; end if;
    return 'austritt_bestaetigt';
  end if;
  if m.bestaetigt_am is null then return 'nicht_angetreten_gemeldet'; end if;
  if app.storno_noetig(p_dv) and not app.bestaetigung_liegt_vor(p_dv, 'storno') then
    return 'storno_ausstaendig';
  end if;
  return 'nicht_angetreten';
end $$;

-- Art der fälligen Meldung an den Lohnverrechner: abmeldung, storno, korrektur oder null.
-- Korrektur nur, wenn der Lohnverrechner zuletzt eine gültige (nicht zurückgenommene) frühere Fassung bekommen hat.
create or replace function app.meldung_art(p_meldung public.austritt_meldung) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_zuletzt public.austritt_meldung%rowtype;
begin
  if p_meldung.id is null or p_meldung.bestaetigt_am is null then return null; end if;
  select a.* into v_zuletzt from public.dokument x join public.austritt_meldung a on a.id = x.austritt_meldung_id
  where a.dienstverhaeltnis_id = p_meldung.dienstverhaeltnis_id and a.id <> p_meldung.id and x.uebermittelt_am is not null
  order by x.uebermittelt_am desc limit 1;
  if v_zuletzt.id is not null and not v_zuletzt.zurueckgenommen then return 'korrektur'; end if;
  if p_meldung.zurueckgenommen then return null; end if;
  if p_meldung.art = 'austritt' then return 'abmeldung'; end if;
  if app.storno_noetig(p_meldung.dienstverhaeltnis_id) then return 'storno'; end if;
  return null;
end $$;

create or replace function public.uebermittlung_vermerken(p_dokument_ids uuid[])
returns table (sammelversand_id uuid, lohnverrechner_id uuid, vermerkt int)
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := app.organisation_id();
  r record;
  v_ids uuid[];
  v_id uuid;
begin
  if not app.ist_buero() then raise exception 'Das darf nur das Personalbüro.'; end if;
  -- nur, was noch offen ist: inzwischen ersetzte, schon vermerkte oder zu einer alten Fassung gehörende
  -- Unterlagen bleiben unverändert
  for r in
    select g.lohnverrechner_id as lv, array_agg(x.id order by x.id) as ids
    from public.dokument x
    join public.dienstverhaeltnis d on d.id = x.dienstverhaeltnis_id
    join public.gesellschaft g on g.id = d.gesellschaft_id
    where x.id = any(p_dokument_ids) and x.organisation_id = v_org
      and x.uebermittelt_am is null and x.ersetzt_durch is null
      and ((x.typ = 'dienstzettel' and x.status = 'abgeschlossen' and x.neu_angefordert_am is null)
           or (x.typ in ('austrittsmeldung', 'stornomeldung', 'korrekturmeldung')
               and x.austritt_meldung_id = (app.letzte_meldung(x.dienstverhaeltnis_id)).id))
    group by g.lohnverrechner_id
  loop
    with u as (
      update public.dokument set uebermittelt_am = now(), uebermittelt_von = auth.uid()
      where id = any(r.ids) and uebermittelt_am is null
      returning id)
    select array_agg(id order by id) into v_ids from u;
    if coalesce(cardinality(v_ids), 0) = 0 then continue; end if;
    insert into public.sammelversand (organisation_id, lohnverrechner_id, gesendet_von, dokument_ids)
    values (v_org, r.lv, auth.uid(), v_ids) returning id into v_id;
    sammelversand_id := v_id; lohnverrechner_id := r.lv; vermerkt := cardinality(v_ids);
    return next;
  end loop;
end $$;

create or replace function public.uebermittlung_offen()
returns table (lohnverrechner_id uuid, lohnverrechner_name text, lohnverrechner_email text, dienstverhaeltnis_id uuid,
               vorname text, nachname text, gesellschaft text, art text, dokument_id uuid, meldung_id uuid, datum date)
language sql stable security definer set search_path = '' as $$
  with dv as (
    select d.id, d.eintritt, d.austritt, m.vorname, m.nachname, g.name as gmbh, l.id as lv_id,
           coalesce(l.name, 'Kein Lohnverrechner hinterlegt') as lv_name, l.email as lv_email
    from public.dienstverhaeltnis d
    join public.mitarbeiter m on m.id = d.mitarbeiter_id
    join public.gesellschaft g on g.id = d.gesellschaft_id
    left join public.lohnverrechner l on l.id = g.lohnverrechner_id
    where d.organisation_id = app.organisation_id() and app.ist_buero()
  ),
  anmeldung as (
    select dv.*, 'anmeldung'::text as art, x.id as dok, null::uuid as meld, dv.eintritt as datum
    from dv
    join public.dokument x on x.dienstverhaeltnis_id = dv.id and x.typ = 'dienstzettel' and x.status = 'abgeschlossen'
      and x.ersetzt_durch is null and x.neu_angefordert_am is null and x.uebermittelt_am is null
    where app.dv_status(dv.id) not in ('nicht_angetreten', 'storno_ausstaendig', 'nicht_angetreten_gemeldet')
  ),
  meldung as (
    select dv.*, app.meldung_art(lm.r) as art, (lm.r).id as meld, coalesce((lm.r).letzter_arbeitstag, dv.eintritt) as datum
    from dv cross join lateral (select app.letzte_meldung(dv.id) as r) lm
    where (lm.r).id is not null
  ),
  mit_pdf as (
    select me.id, me.eintritt, me.austritt, me.vorname, me.nachname, me.gmbh, me.lv_id, me.lv_name, me.lv_email,
           case x.typ when 'austrittsmeldung' then 'abmeldung' when 'stornomeldung' then 'storno'
                      when 'korrekturmeldung' then 'korrektur' else me.art end as art,
           me.meld, me.datum, x.id as dok, x.uebermittelt_am
    from meldung me
    left join public.dokument x on x.austritt_meldung_id = me.meld and x.ersetzt_durch is null
    where me.art is not null
  )
  select lv_id, lv_name, lv_email, id, vorname, nachname, gmbh, art, dok, meld, datum from anmeldung
  union all
  select lv_id, lv_name, lv_email, id, vorname, nachname, gmbh, art, dok, meld, datum from mit_pdf where uebermittelt_am is null
  order by 2, 6, 5
$$;

create or replace function public.austritt_korrigieren(
  p_meldung_id         uuid,
  p_grund              text,
  p_letzter_arbeitstag date default null,
  p_austrittsart       text default null,
  p_zuruecknehmen      boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := app.organisation_id();
  v_m   public.austritt_meldung%rowtype;
  v_dv  public.dienstverhaeltnis%rowtype;
  v_zurueck boolean := coalesce(p_zuruecknehmen, false);
  v_tag date; v_art text;
  v_neu uuid := gen_random_uuid();
begin
  if not app.ist_buero() then raise exception 'Das darf nur das Personalbüro.'; end if;
  if nullif(trim(p_grund), '') is null then raise exception 'Bitte einen Grund angeben.'; end if;
  select * into v_m from public.austritt_meldung where id = p_meldung_id and organisation_id = v_org for update;
  if v_m.id is null then raise exception 'Diese Meldung wurde nicht gefunden.'; end if;
  if v_m.ersetzt_durch is not null or v_m.zurueckgenommen then
    raise exception 'Diese Meldung wurde inzwischen geändert. Bitte die Seite neu laden.';
  end if;
  select * into v_dv from public.dienstverhaeltnis where id = v_m.dienstverhaeltnis_id for update;

  if not v_zurueck then
    if v_m.bestaetigt_am is null then
      raise exception 'Diese Meldung ist noch nicht bestätigt. Datum und Art lassen sich beim Bestätigen ändern.';
    end if;
    if v_m.art = 'nicht_angetreten' then
      raise exception 'Bei „nicht angetreten“ ist nur Zurücknehmen möglich.';
    end if;
    v_tag := coalesce(p_letzter_arbeitstag, v_m.letzter_arbeitstag);
    v_art := coalesce(p_austrittsart, v_m.austrittsart);
    perform app.austritt_pruefen(v_dv, v_tag, v_art);
  end if;

  update public.austritt_meldung set ersetzt_durch = v_neu, ersetzt_am = now() where id = v_m.id;
  insert into public.austritt_meldung (id, organisation_id, dienstverhaeltnis_id, art, letzter_arbeitstag, austrittsart, notiz,
    gemeldet_von, gemeldet_am, bestaetigt_von, bestaetigt_am, zurueckgenommen, korrektur_grund)
  values (v_neu, v_org, v_m.dienstverhaeltnis_id, v_m.art,
    case when v_zurueck then v_m.letzter_arbeitstag else v_tag end,
    case when v_zurueck then v_m.austrittsart else v_art end,
    v_m.notiz, v_m.gemeldet_von, v_m.gemeldet_am, auth.uid(), now(), v_zurueck, trim(p_grund));

  update public.dienstverhaeltnis set austritt = case when v_zurueck or v_m.art = 'nicht_angetreten' then null else v_tag end
  where id = v_dv.id;
  return v_neu;
end $$;

revoke execute on function app.storno_noetig(uuid) from public, anon, authenticated;
