-- Stundenanpassung: jede Änderung der Arbeitszeit ist ein neuer Stand mit eigener Vereinbarung.
-- Ein falscher Stand wird nie gelöscht, sondern storniert (mit Grund) und bleibt sichtbar.

create or replace function public.stunden_anpassen(
  p_dienstverhaeltnis_id uuid,
  p_gueltig_ab           date,
  p_beschaeftigungsart   text,
  p_wochenstunden        numeric,
  p_arbeitstage_woche    int,
  p_netto                numeric
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org    public.organisation%rowtype;
  v_dv     public.dienstverhaeltnis%rowtype;
  v_letzt  date;
  v_brutto numeric;
  v_stand  uuid;
begin
  if not app.ist_buero() then raise exception 'Stundenanpassungen trägt das Personalbüro ein.'; end if;
  select * into v_org from public.organisation where id = app.organisation_id();
  select * into v_dv from public.dienstverhaeltnis where id = p_dienstverhaeltnis_id and organisation_id = v_org.id;
  if v_dv.id is null then raise exception 'Diese Person wurde nicht gefunden.'; end if;

  if p_gueltig_ab is null then raise exception 'Bitte angeben, ab wann die Anpassung gilt.'; end if;
  if p_gueltig_ab < v_dv.eintritt then
    raise exception 'Die Anpassung kann nicht vor dem Dienstantritt (%) gelten.', to_char(v_dv.eintritt, 'DD.MM.YYYY');
  end if;
  if p_gueltig_ab > current_date + 365 then raise exception 'Die Anpassung liegt mehr als 1 Jahr in der Zukunft.'; end if;
  if v_dv.austritt is not null and p_gueltig_ab > v_dv.austritt then
    raise exception 'Die Anpassung liegt nach dem Austritt (%).', to_char(v_dv.austritt, 'DD.MM.YYYY');
  end if;
  if exists (select 1 from public.vertragsstand where dienstverhaeltnis_id = v_dv.id
             and gueltig_ab = p_gueltig_ab and storniert_am is null) then
    raise exception 'Für den % gibt es schon einen Stand.', to_char(p_gueltig_ab, 'DD.MM.YYYY');
  end if;
  select max(gueltig_ab) into v_letzt from public.vertragsstand
  where dienstverhaeltnis_id = v_dv.id and storniert_am is null;
  if v_letzt > p_gueltig_ab then
    raise exception 'Es gibt schon einen späteren Stand (ab %). Bitte zuerst diesen stornieren.', to_char(v_letzt, 'DD.MM.YYYY');
  end if;

  perform app.arbeitszeit_pruefen(v_org, p_beschaeftigungsart, p_wochenstunden, p_arbeitstage_woche, p_netto);

  v_brutto := app.brutto_fuer(v_org.id,
    (select s.tarifzone_id from public.standort s where s.id = v_dv.heimstandort_id), p_netto, p_gueltig_ab);

  insert into public.vertragsstand (organisation_id, dienstverhaeltnis_id, gueltig_ab,
                                    beschaeftigungsart, wochenstunden, arbeitstage_woche)
  values (v_org.id, v_dv.id, p_gueltig_ab, p_beschaeftigungsart, p_wochenstunden, p_arbeitstage_woche)
  returning id into v_stand;

  insert into public.entgelt (organisation_id, dienstverhaeltnis_id, vertragsstand_id, netto, brutto, quelle, gueltig_ab)
  values (v_org.id, v_dv.id, v_stand, p_netto, v_brutto,
          case when v_brutto is null then 'offen' else 'tabelle' end, p_gueltig_ab);

  insert into public.dokument (organisation_id, dienstverhaeltnis_id, typ, kategorie, bezeichnung, vertragsstand_id)
  values (v_org.id, v_dv.id, 'einzelvereinbarung', 'vereinbarung', 'Vereinbarung Stundenanpassung', v_stand);

  return v_stand;
end $$;

create or replace function public.stand_stornieren(p_vertragsstand_id uuid, p_grund text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_stand public.vertragsstand%rowtype;
begin
  if not app.ist_buero() then raise exception 'Stornieren kann nur das Personalbüro.'; end if;
  if coalesce(trim(p_grund), '') = '' then raise exception 'Bitte einen Grund angeben.'; end if;
  select * into v_stand from public.vertragsstand
  where id = p_vertragsstand_id and organisation_id = app.organisation_id();
  if v_stand.id is null then raise exception 'Dieser Stand wurde nicht gefunden.'; end if;
  if v_stand.storniert_am is not null then raise exception 'Dieser Stand ist schon storniert.'; end if;
  if v_stand.gueltig_ab = (select d.eintritt from public.dienstverhaeltnis d where d.id = v_stand.dienstverhaeltnis_id) then
    raise exception 'Der Stand aus dem Dienstzettel kann nicht storniert werden.';
  end if;

  update public.vertragsstand set storniert_am = now(), storniert_von = auth.uid(), storno_grund = trim(p_grund)
  where id = v_stand.id;
  update public.entgelt set storniert_am = now() where vertragsstand_id = v_stand.id and storniert_am is null;
end $$;

revoke execute on function public.stunden_anpassen(uuid, date, text, numeric, int, numeric),
  public.stand_stornieren(uuid, text) from public, anon;
grant execute on function public.stunden_anpassen(uuid, date, text, numeric, int, numeric),
  public.stand_stornieren(uuid, text) to authenticated;
