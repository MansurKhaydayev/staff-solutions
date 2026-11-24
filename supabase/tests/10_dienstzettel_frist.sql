-- Dienstzettel: kein Dienstantritt in der Vergangenheit, Fristregel, dringende Anmeldung, „angemeldet“
begin;
do $$
declare
  org uuid := 'de000000-0000-0000-0000-000000000001';
  hr uuid := testhilfe.benutzer('hr');
  sl uuid := testhilfe.benutzer('studioleitung', array['de000000-0000-0000-0000-0000000000e1']::uuid[]);
  dv uuid;
  frueh date;
  aufruf text := $a$select public.dienstzettel_erfassen(
    p_standort_id => 'de000000-0000-0000-0000-0000000000e1', p_funktion_id => 'de000000-0000-0000-0000-0000000000f1',
    p_vorname => 'Test', p_nachname => 'Frist', p_eintritt => %L::date,
    p_beschaeftigungsart => 'teilzeit', p_wochenstunden => 20, p_arbeitstage_woche => 5, p_netto => 1000,
    p_anrede => 'Frau', p_geburtsdatum => date '1990-01-01', p_strasse => 'Testgasse 1', p_plz => '8010',
    p_ort => 'Graz', p_telefon => '+43 660 1234567', p_email => 'test@example.com',
    p_staatsangehoerigkeit => 'Österreich', p_iban => 'AT611904300234573201', p_sv_nummer => '1238010190',
    p_dringend_grund => %L)$a$;
begin
  frueh := app.fruehester_dienstantritt(org, app.jetzt_wien());
  perform testhilfe.als(sl);
  perform testhilfe.erwarte_fehler(format(aufruf, app.heute_wien() - 1, null), 'nicht in der Vergangenheit');
  perform testhilfe.erwarte_fehler(format(aufruf, frueh - 1, null), 'Zu kurzfristig. Frühester Dienstantritt ist');
  perform testhilfe.erwarte_fehler(format(aufruf, app.heute_wien() - 1, 'Personalmangel'), 'nicht in der Vergangenheit');
  execute format(aufruf, frueh - 1, 'Personalmangel Spätdienst') into dv;
  perform testhilfe.zurueck();
  perform testhilfe.pruefe((select dringend_grund = 'Personalmangel Spätdienst' and dringend_von = sl and dringend_am is not null
    from public.dienstverhaeltnis where id = dv), 'dringende Anmeldung mit Grund, wer und wann gespeichert');

  perform testhilfe.als(sl);
  execute format(aufruf, frueh, 'unnötig') into dv;
  perform testhilfe.zurueck();
  perform testhilfe.pruefe((select dringend_grund is null from public.dienstverhaeltnis where id = dv),
    'rechtzeitig: kein Dringend-Vermerk, auch wenn ein Grund mitgeschickt wird');

  -- angemeldet erst mit Anmeldebestätigung
  perform testhilfe.als(hr);
  perform testhilfe.pruefe(not (public.akte_kopf(dv) ->> 'angemeldet')::boolean, 'Akte: noch nicht angemeldet');
  perform testhilfe.pruefe((select not angemeldet from public.mitarbeiter_verzeichnis() where dienstverhaeltnis_id = dv),
    'Verzeichnis: noch nicht angemeldet');
  perform testhilfe.zurueck();
  insert into storage.objects (bucket_id, name, metadata)
  values ('personalakte', org || '/' || dv || '/anmeldung/a.pdf', '{"size":1000,"mimetype":"application/pdf"}');
  perform testhilfe.als(hr);
  perform public.dokument_ablegen(org || '/' || dv || '/anmeldung/a.pdf', repeat('ab', 32), 'anmeldung', 'Anmeldung ÖGK', dv);
  perform testhilfe.pruefe((public.akte_kopf(dv) ->> 'angemeldet')::boolean, 'Akte: angemeldet');
  perform testhilfe.pruefe((select angemeldet from public.mitarbeiter_verzeichnis() where dienstverhaeltnis_id = dv), 'Verzeichnis: angemeldet');
  perform testhilfe.zurueck();
end $$;
select 'alle Tests bestanden' as ergebnis;
rollback;
