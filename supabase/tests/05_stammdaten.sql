-- Stammdatenänderungen: alter Wert bleibt, Nachweis-Dokument, Sperre gegen direktes Ändern
begin;
do $$
declare
  hr uuid := testhilfe.benutzer('hr');
  rl uuid := testhilfe.benutzer('regionalleitung', array['de000000-0000-0000-0000-0000000000e1']::uuid[]);
  dv uuid; dv2 uuid; ma uuid; ma2 uuid; dok uuid;
  aufruf text := 'select public.stammdaten_aendern(%L, %L::jsonb, %L::date, %L)';
  n int;
begin
  dv := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1');
  dv2 := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1', true);
  select mitarbeiter_id into ma from public.dienstverhaeltnis where id = dv;
  select mitarbeiter_id into ma2 from public.dienstverhaeltnis where id = dv2;

  perform testhilfe.als(hr);
  dok := public.stammdaten_aendern(ma, '{"nachname": "Neumann"}', current_date, 'Heirat');
  perform testhilfe.pruefe((select nachname = 'Neumann' from public.mitarbeiter where id = ma), 'neuer Nachname gilt');
  perform testhilfe.pruefe((select alt = 'Person' and neu = 'Neumann' and stufe = 'personendaten' and grund = 'Heirat'
    and dokument_id = dok from public.stammdaten_aenderung where mitarbeiter_id = ma and feld = 'nachname'), 'alter und neuer Wert gespeichert');
  perform testhilfe.pruefe((select kategorie = 'nachweis_personendaten' and datei_pfad is null and dienstverhaeltnis_id = dv
    from public.dokument where id = dok), 'Nachweis-Dokument ohne Datei angelegt');

  -- Prüfschwerpunkt 4: gleicher Wert in anderer Schreibweise
  perform testhilfe.erwarte_fehler(format(aufruf, ma, '{"iban": "at61 1904 3002 3457 3201"}', current_date, 'Bank'), 'IBAN ist unverändert.');
  perform testhilfe.erwarte_fehler(format(aufruf, ma, '{"iban": "AT61 1904 3002 3457 3202"}', current_date, 'Bank'), 'Die IBAN ist ungültig.');
  perform testhilfe.erwarte_fehler(format(aufruf, ma, '{"ort": "Wien", "iban": "DE89370400440532013000"}', current_date, 'x'), 'getrennt eintragen');
  perform testhilfe.erwarte_fehler(format(aufruf, ma, '{"ort": "Wien"}', current_date - 91, 'Umzug'), 'mehr als 3 Monate zurück');
  perform testhilfe.erwarte_fehler(format(aufruf, ma, '{"ort": "Wien"}', current_date + 1, 'Umzug'), 'nicht in der Zukunft');
  perform testhilfe.erwarte_fehler(format(aufruf, ma, '{"ort": "Wien"}', current_date, ' '), 'Bitte einen Grund angeben.');
  perform testhilfe.erwarte_fehler(format(aufruf, ma, '{"plz": "80"}', current_date, 'Umzug'), 'PLZ hat 4 oder 5 Ziffern.');
  perform testhilfe.erwarte_fehler(format(aufruf, ma, '{"sv_nummer": "1238010191"}', current_date, 'x'), 'Prüfziffer');
  perform testhilfe.erwarte_fehler(format(aufruf, ma, '{"gehalt": "1"}', current_date, 'x'), 'Unbekanntes Feld');

  -- Bankwechsel: Lohnverrechnungsdaten
  perform public.stammdaten_aendern(ma, '{"iban": "DE89 3704 0044 0532 0130 00", "bic": "cobadeffxxx"}', current_date - 5, 'Bankwechsel');
  perform testhilfe.pruefe((select iban = 'DE89370400440532013000' and bic = 'COBADEFFXXX' from public.mitarbeiter_sensibel
    where mitarbeiter_id = ma), 'neue Bankverbindung gilt (normalisiert)');
  select count(*) into n from public.stammdaten_aenderung where mitarbeiter_id = ma and stufe = 'lohnverrechnung';
  perform testhilfe.pruefe(n = 2, 'je Feld ein Eintrag');

  -- Direktes Ändern ist gesperrt
  perform testhilfe.erwarte_fehler(format('update public.mitarbeiter set nachname = %L where id = %L', 'X', ma), 'Änderung eintragen');
  perform testhilfe.erwarte_fehler(format('update public.mitarbeiter_sensibel set iban = %L where mitarbeiter_id = %L',
    'AT611904300234573201', ma), 'Änderung eintragen');

  -- Versicherungsnummer nachreichen ist eine Ergänzung (ohne Nachweis)
  perform public.sv_nummer_nachtragen(ma2, '1238 010190');
  perform testhilfe.pruefe((select sv_nummer = '1238010190' and not sv_nummer_nachreichen from public.mitarbeiter_sensibel
    where mitarbeiter_id = ma2), 'nachgereichte Nummer eingetragen');
  perform testhilfe.pruefe((select ist_ergaenzung and dokument_id is null and alt is null from public.stammdaten_aenderung
    where mitarbeiter_id = ma2), 'Ergänzung ohne Nachweis vermerkt');
  perform testhilfe.erwarte_fehler(format('select public.sv_nummer_nachtragen(%L, %L)', ma2, '1238010190'), 'schon eingetragen');
  perform testhilfe.zurueck();

  -- Regionalleitung: sieht Personendaten-Änderungen, keine Lohnverrechnung, ändert nichts
  perform testhilfe.als(rl);
  select count(*) into n from public.stammdaten_aenderung where mitarbeiter_id = ma and stufe = 'personendaten';
  perform testhilfe.pruefe(n = 1, 'Regionalleitung sieht die Namensänderung');
  select count(*) into n from public.stammdaten_aenderung where mitarbeiter_id = ma and stufe = 'lohnverrechnung';
  perform testhilfe.pruefe(n = 0, 'Regionalleitung sieht keine Bankänderung');
  perform testhilfe.erwarte_fehler(format(aufruf, ma, '{"ort": "Wien"}', current_date, 'Umzug'), 'trägt das Personalbüro ein');
  perform testhilfe.zurueck();
end $$;
select 'alle Tests bestanden' as ergebnis;
rollback;
