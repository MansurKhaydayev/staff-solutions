-- Akte: Kopfdaten je Rolle (nur, was die Rolle sehen darf), Protokoll, offene Punkte.

-- Liegt dieses Dienstverhältnis in der Reichweite der angemeldeten Person?
create or replace function app.in_reichweite(p_dv uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profil p
    join public.rollen_recht r on r.organisation_id = p.organisation_id and r.rolle = p.rolle
    join public.dienstverhaeltnis d on d.id = p_dv and d.organisation_id = p.organisation_id
    where p.user_id = (select auth.uid())
      and case r.reichweite
            when 'alle' then true
            when 'zugeordnet' then exists (select 1 from public.zustaendigkeit z
                                           where z.user_id = p.user_id and z.standort_id = d.heimstandort_id)
            else d.mitarbeiter_id = p.mitarbeiter_id
          end)
$$;

-- Stände ohne hochgeladene Vereinbarung (ohne den Stand aus dem Dienstzettel)
create or replace function app.staende_ohne_nachweis(p_dv uuid) returns setof date
language sql stable security definer set search_path = '' as $$
  select v.gueltig_ab from public.vertragsstand v
  join public.dienstverhaeltnis d on d.id = v.dienstverhaeltnis_id
  where v.dienstverhaeltnis_id = p_dv and v.storniert_am is null and v.gueltig_ab <> d.eintritt
    and not exists (select 1 from public.dokument x where x.vertragsstand_id = v.id
                    and x.datei_pfad is not null and x.ersetzt_durch is null)
  order by v.gueltig_ab
$$;

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
    'eintritt', v_dv.eintritt, 'austritt', v_dv.austritt, 'befristet_bis', v_dv.befristet_bis,
    'rechte', jsonb_build_object('kontakt', v_k, 'personendaten', v_p, 'entgelt', v_e, 'lohnverrechnung', v_l,
      'dokumente', v_d, 'buero', app.ist_buero(), 'hochladen_onboarding', app.darf_hochladen('onboarding', v_dv.id)));

  if v_k then
    v_kopf := v_kopf || jsonb_build_object('telefon', v_ma.telefon, 'email', v_ma.email);
  end if;
  if v_p then
    v_stand := app.stand_am(v_dv.id, v_tag);
    v_kopf := v_kopf || jsonb_build_object(
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

create or replace function public.akte_protokoll(p_dienstverhaeltnis_id uuid)
returns table (zeitpunkt timestamptz, wer text, tabelle text, aktion text, alt jsonb, neu jsonb)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_dv public.dienstverhaeltnis%rowtype;
begin
  if not app.ist_buero() then raise exception 'Keine Berechtigung für das Protokoll.'; end if;
  select * into v_dv from public.dienstverhaeltnis where id = p_dienstverhaeltnis_id and organisation_id = app.organisation_id();
  if v_dv.id is null then raise exception 'Keine Berechtigung für das Protokoll.'; end if;
  return query
  select a.zeitpunkt, u.email::text, a.tabelle, a.aktion, a.alt, a.neu
  from public.audit_log a
  left join auth.users u on u.id = a.user_id
  where a.organisation_id = v_dv.organisation_id
    and (a.datensatz_id in (v_dv.id, v_dv.mitarbeiter_id)
      or coalesce(a.neu, a.alt) ->> 'dienstverhaeltnis_id' = v_dv.id::text
      or coalesce(a.neu, a.alt) ->> 'mitarbeiter_id' = v_dv.mitarbeiter_id::text)
  order by a.zeitpunkt desc, a.id desc
  limit 200;
end $$;

create or replace function public.offene_punkte()
returns table (dienstverhaeltnis_id uuid, vorname text, nachname text, standort_id uuid, art text, beschreibung text, datum date)
language sql stable security definer set search_path = '' as $$
  with aktiv as (
    select d.id, d.mitarbeiter_id, d.heimstandort_id, d.eintritt, m.vorname, m.nachname
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
$$;

revoke execute on function app.in_reichweite(uuid), app.staende_ohne_nachweis(uuid) from public, anon;
grant execute on function app.in_reichweite(uuid), app.staende_ohne_nachweis(uuid) to authenticated;
revoke execute on function public.akte_kopf(uuid), public.akte_protokoll(uuid), public.offene_punkte() from public, anon;
grant execute on function public.akte_kopf(uuid), public.akte_protokoll(uuid), public.offene_punkte() to authenticated;
