-- Beweissicherung (aus der Gesamtprüfung): nichts löschen, nichts an den Funktionen vorbei schreiben,
-- Vermerke nicht überschreiben, Reihenfolge der Stände und alte Werte auch bei gleichzeitigem Speichern.
begin;
do $$
declare
  org uuid := 'de000000-0000-0000-0000-000000000001';
  hr uuid := testhilfe.benutzer('hr');
  verw uuid := testhilfe.benutzer('verwaltung');
  sl uuid := testhilfe.benutzer('studioleitung', array['de000000-0000-0000-0000-0000000000e1']::uuid[]);
  dv uuid; ma uuid; st uuid; vermerk uuid;
  h text := repeat('ab', 32);
begin
  dv := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1');
  select mitarbeiter_id into ma from public.dienstverhaeltnis where id = dv;
  insert into public.zulage (organisation_id, dienstverhaeltnis_id, art, netto, gueltig_ab)
    values (org, dv, 'Leiterzulage', 200, current_date);

  perform testhilfe.als(hr);
  -- Kritisch: Lohnverrechnungsdaten löschen und neu anlegen
  perform testhilfe.erwarte_fehler(format('delete from public.mitarbeiter_sensibel where mitarbeiter_id = %L', ma), 'nie gelöscht');
  perform testhilfe.erwarte_fehler(format('delete from public.zulage where dienstverhaeltnis_id = %L', dv), 'nie gelöscht');
  perform testhilfe.erwarte_fehler(format('delete from public.mitarbeiter where id = %L', ma), 'nie gelöscht');
  perform testhilfe.erwarte_fehler(format('delete from public.dienstverhaeltnis where id = %L', dv), 'nie gelöscht');
  -- Wichtig: an den Funktionen vorbei schreiben
  perform testhilfe.erwarte_fehler(format('update public.entgelt set netto = 1 where dienstverhaeltnis_id = %L', dv), 'nur über die Personalakte');
  perform testhilfe.erwarte_fehler(format(
    'insert into public.dokument (organisation_id, dienstverhaeltnis_id, typ, kategorie, datei_pfad) values (%L, %L, %L, %L, %L)',
    org, dv, 'einzelvereinbarung', 'vereinbarung', 'x/y/z.pdf'), 'nur über die Personalakte');
  perform testhilfe.erwarte_fehler(format('update public.zulage set netto = 1 where dienstverhaeltnis_id = %L', dv), 'nur über die Personalakte');
  -- Die Funktionen selbst funktionieren weiter
  st := public.stunden_anpassen(dv, current_date + 30, 'vollzeit', 40, 5, 1500);
  perform testhilfe.pruefe(st is not null, 'Stundenanpassung über die Funktion klappt');
  perform testhilfe.erwarte_fehler(format('update public.dokument set status = %L where dienstverhaeltnis_id = %L', 'abgeschlossen', dv),
    'nur über die Personalakte');
  -- Büro-Vermerk (Ablehnung ohne Datei)
  vermerk := public.onboarding_vermerken(dv, 'de000000-0000-0000-0000-0000000000b2', 'Mündlich abgelehnt');
  perform testhilfe.zurueck();

  -- Wichtig: Leitung überschreibt den Vermerk nicht
  insert into storage.objects (bucket_id, name, metadata)
  values ('personalakte', org || '/' || dv || '/onboarding/v.pdf', '{"size":1000,"mimetype":"application/pdf"}');
  perform testhilfe.als(sl);
  perform testhilfe.erwarte_fehler(format('select public.dokument_ablegen(%L, %L, %L, %L, %L, p_dokument_id => %L)',
    org || '/' || dv || '/onboarding/v.pdf', h, 'onboarding', null, dv, vermerk), 'schon ein Ergebnis');
  perform testhilfe.zurueck();

  -- Wichtig: Reihenfolge der Stände und alter Wert werden beim Speichern noch einmal geprüft
  perform testhilfe.erwarte_fehler(format(
    'insert into public.vertragsstand (organisation_id, dienstverhaeltnis_id, gueltig_ab, beschaeftigungsart, wochenstunden, arbeitstage_woche) values (%L, %L, %L, %L, 25, 5)',
    org, dv, current_date + 10, 'teilzeit'), 'späteren Stand');
  perform testhilfe.erwarte_fehler(format(
    'insert into public.vertragsstand (organisation_id, dienstverhaeltnis_id, gueltig_ab, beschaeftigungsart, wochenstunden, arbeitstage_woche) values (%L, %L, %L, %L, 25, 5)',
    org, dv, current_date + 30, 'teilzeit'), 'gibt es schon einen Stand');
  perform testhilfe.erwarte_fehler(format(
    'insert into public.stammdaten_aenderung (organisation_id, mitarbeiter_id, feld, stufe, alt, neu, gueltig_ab, grund) values (%L, %L, %L, %L, %L, %L, current_date, %L)',
    org, ma, 'nachname', 'personendaten', 'Veraltet', 'Neu', 'x'), 'von jemand anderem geändert');

  -- Wichtig (hochgestuft): Befristung nur mit Personendaten
  perform testhilfe.als(verw);
  perform testhilfe.pruefe(not (public.akte_kopf(dv) ? 'befristet_bis'), 'Verwaltung sieht die Befristung nicht');
  perform testhilfe.zurueck();
  perform testhilfe.als(hr);
  perform testhilfe.pruefe(public.akte_kopf(dv) ? 'befristet_bis', 'Personalbüro sieht die Befristung');
  perform testhilfe.zurueck();
end $$;
select 'alle Tests bestanden' as ergebnis;
rollback;
