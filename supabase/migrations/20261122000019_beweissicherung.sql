-- Beweissicherung (Ergebnis der Gesamtprüfung):
-- 1. Stammdaten, Dienstverhältnisse und Zulagen werden nie gelöscht.
-- 2. Entgelt, Dokumente, Zulagen und Lohnverrechnungsdaten ändern sich nur über die Funktionen
--    der Personalakte, nicht durch direkte Aufrufe an der App vorbei.
-- 3. Ein Büro-Vermerk (Ablehnung ohne Datei) kann nicht nachträglich mit einer Datei überschrieben werden.
-- 4. Beim Speichern werden Reihenfolge der Stände und alter Wert noch einmal geprüft – mit Sperre,
--    damit zwei Leute gleichzeitig nichts durcheinanderbringen.
-- 5. Die Befristung sieht nur, wer Personendaten sehen darf.

-- 1. Nie löschen
create trigger loeschen_verboten before delete on public.mitarbeiter
  for each row execute function app.loeschen_verboten();
create trigger loeschen_verboten before delete on public.mitarbeiter_sensibel
  for each row execute function app.loeschen_verboten();
create trigger loeschen_verboten before delete on public.dienstverhaeltnis
  for each row execute function app.loeschen_verboten();
create trigger loeschen_verboten before delete on public.zulage
  for each row execute function app.loeschen_verboten();

-- 2. Nur über Funktionen. Funktionen der Personalakte laufen als Eigentümer der Datenbank;
--    ein direkter Aufruf aus der App läuft als "authenticated" und wird abgewiesen.
create or replace function app.nur_ueber_funktionen() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    raise exception 'Diese Daten ändern sich nur über die Personalakte (Stundenanpassung, Änderung eintragen, Hochladen).';
  end if;
  return new;
end $$;
create trigger nur_ueber_funktionen before insert or update on public.entgelt
  for each row execute function app.nur_ueber_funktionen();
create trigger nur_ueber_funktionen before insert or update on public.dokument
  for each row execute function app.nur_ueber_funktionen();
create trigger nur_ueber_funktionen before insert or update on public.zulage
  for each row execute function app.nur_ueber_funktionen();
create trigger nur_ueber_funktionen before insert on public.mitarbeiter_sensibel
  for each row execute function app.nur_ueber_funktionen();

-- 3. Vermerk nicht überschreiben
create or replace function app.vermerk_schuetzen() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.datei_pfad is null and new.datei_pfad is not null and old.onboarding_ergebnis is not null then
    raise exception 'Für diese Unterlage ist schon ein Ergebnis vermerkt. Bitte die Unterlage neu hochladen.';
  end if;
  return new;
end $$;
create trigger vermerk_schuetzen before update on public.dokument
  for each row execute function app.vermerk_schuetzen();

-- 4a. Stände: Sperre je Dienstverhältnis, dann Reihenfolge prüfen
create or replace function app.stand_pruefen() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_letzt date;
begin
  perform 1 from public.dienstverhaeltnis where id = new.dienstverhaeltnis_id for update;
  if exists (select 1 from public.vertragsstand where dienstverhaeltnis_id = new.dienstverhaeltnis_id
             and gueltig_ab = new.gueltig_ab and storniert_am is null) then
    raise exception 'Für den % gibt es schon einen Stand.', to_char(new.gueltig_ab, 'DD.MM.YYYY');
  end if;
  select max(gueltig_ab) into v_letzt from public.vertragsstand
  where dienstverhaeltnis_id = new.dienstverhaeltnis_id and storniert_am is null;
  if v_letzt > new.gueltig_ab then
    raise exception 'Es gibt schon einen späteren Stand (ab %). Bitte zuerst diesen stornieren.', to_char(v_letzt, 'DD.MM.YYYY');
  end if;
  return new;
end $$;
create trigger stand_pruefen before insert on public.vertragsstand
  for each row execute function app.stand_pruefen();

-- 4b. Stammdaten: Sperre je Person, dann prüfen, ob der alte Wert noch stimmt
create or replace function app.aenderung_pruefen() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ma   public.mitarbeiter%rowtype;
  v_sens public.mitarbeiter_sensibel%rowtype;
  v_jetzt text;
begin
  select * into v_ma from public.mitarbeiter where id = new.mitarbeiter_id for update;
  select * into v_sens from public.mitarbeiter_sensibel where mitarbeiter_id = new.mitarbeiter_id;
  v_jetzt := case new.feld
    when 'anrede' then v_ma.anrede when 'vorname' then v_ma.vorname when 'nachname' then v_ma.nachname
    when 'geburtsdatum' then v_ma.geburtsdatum::text when 'strasse' then v_ma.strasse when 'plz' then v_ma.plz
    when 'ort' then v_ma.ort when 'telefon' then v_ma.telefon when 'email' then v_ma.email
    when 'sv_nummer' then v_sens.sv_nummer when 'iban' then v_sens.iban when 'bic' then v_sens.bic
    when 'staatsangehoerigkeit' then v_sens.staatsangehoerigkeit end;
  if v_sens.mitarbeiter_id is null and new.stufe = 'lohnverrechnung' then
    raise exception 'Für diese Person fehlen die Lohnverrechnungsdaten. Bitte den Betreiber verständigen.';
  end if;
  if v_jetzt is distinct from new.alt then
    raise exception 'Die Angaben wurden gerade von jemand anderem geändert. Bitte die Akte neu laden und noch einmal eintragen.';
  end if;
  return new;
end $$;
create trigger aenderung_pruefen before insert on public.stammdaten_aenderung
  for each row execute function app.aenderung_pruefen();

revoke execute on function app.nur_ueber_funktionen(), app.vermerk_schuetzen(), app.stand_pruefen(),
  app.aenderung_pruefen() from public, anon, authenticated;

-- 5. Befristung nur mit Personendaten
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

