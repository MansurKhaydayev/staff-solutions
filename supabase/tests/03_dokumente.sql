-- Dokumente: Ablage, Ersetzen, Rechte je Kategorie, Dateiablage (Storage)
begin;
do $$
declare
  org text := 'de000000-0000-0000-0000-000000000001';
  hr uuid := testhilfe.benutzer('hr');
  sl uuid := testhilfe.benutzer('studioleitung', array['de000000-0000-0000-0000-0000000000e1']::uuid[]);
  sl_fremd uuid := testhilfe.benutzer('studioleitung', array['de000000-0000-0000-0000-0000000000e2']::uuid[]);
  buch uuid := testhilfe.benutzer('buchhaltung');
  dv uuid;
  h text := repeat('ab', 32);
  d1 uuid; d2 uuid; d3 uuid; d4 uuid; dleer uuid;
  n int;
  p text;
begin
  dv := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1');

  -- Objekte im Speicher anlegen (so, als wären sie hochgeladen worden)
  insert into storage.objects (bucket_id, name, metadata)
  select 'personalakte', x, '{"size":1234,"mimetype":"application/pdf"}'::jsonb
  from unnest(array[
    org || '/' || dv || '/onboarding/a.pdf', org || '/' || dv || '/onboarding/b.pdf',
    org || '/' || dv || '/onboarding/c.pdf', org || '/' || dv || '/onboarding/d.pdf',
    org || '/' || dv || '/vereinbarung/e.pdf', org || '/' || dv || '/vereinbarung/f.pdf',
    org || '/' || dv || '/onboarding/g.pdf',
    'de000000-0000-0000-0000-000000000099/' || dv || '/onboarding/x.pdf',
    org || '/' || gen_random_uuid() || '/onboarding/y.pdf']) x;
  insert into storage.objects (bucket_id, name, metadata)
  values ('personalakte', org || '/' || dv || '/onboarding/gross.pdf', '{"size":10485761,"mimetype":"application/pdf"}');

  -- Personalbüro legt ab
  perform testhilfe.als(hr);
  d1 := public.dokument_ablegen(org || '/' || dv || '/onboarding/a.pdf', h, 'onboarding', 'Bildaufnahme', dv);
  perform testhilfe.pruefe((select hochgeladen_von = hr and datei_hash = h and kategorie = 'onboarding'
    and datei_typ = 'application/pdf' and datei_groesse = 1234 from public.dokument where id = d1), 'Ablage füllt alle Angaben');
  perform testhilfe.pruefe(public.dokument_ablegen(org || '/' || dv || '/onboarding/a.pdf', h, 'onboarding', 'Bildaufnahme', dv) = d1,
    'gleiche Datei noch einmal ablegen liefert denselben Eintrag');

  -- Falsche Pfade (Prüfschwerpunkt 2)
  perform testhilfe.erwarte_fehler(format('select public.dokument_ablegen(%L, %L, %L, %L, %L)',
    'de000000-0000-0000-0000-000000000099/' || dv || '/onboarding/x.pdf', h, 'onboarding', 'X', dv), 'passt nicht');
  perform testhilfe.erwarte_fehler(format('select public.dokument_ablegen(%L, %L, %L, %L, %L)',
    org || '/' || dv || '/onboarding/a.pdf', h, 'vereinbarung', 'X', dv), 'passt nicht');
  perform testhilfe.erwarte_fehler(format('select public.dokument_ablegen(%L, %L, %L, %L, %L)',
    org || '/' || dv || '/onboarding/fehlt.pdf', h, 'onboarding', 'X', dv), 'Datei nicht gefunden');
  perform testhilfe.erwarte_fehler(format('select public.dokument_ablegen(%L, %L, %L, %L, %L)',
    org || '/' || dv || '/onboarding/gross.pdf', h, 'onboarding', 'X', dv), 'größer als 10 MB');
  perform testhilfe.erwarte_fehler(format('select public.dokument_ablegen(%L, %L, %L, %L, %L)',
    org || '/' || dv || '/onboarding/b.pdf', 'kurz', 'onboarding', 'X', dv), 'Fingerabdruck');
  d2 := public.dokument_ablegen(org || '/' || dv || '/onboarding/b.pdf', h, 'onboarding', 'Arbeitsanweisung', dv);
  perform testhilfe.pruefe(d2 is not null, 'nach einem Fehler klappt der richtige Pfad');

  -- Ersetzen durch das Büro: alter Eintrag bleibt
  d3 := public.dokument_ablegen(org || '/' || dv || '/onboarding/c.pdf', h, 'onboarding', null, dv, p_dokument_id => d1);
  perform testhilfe.pruefe((select ersetzt_durch = d3 and ersetzt_am is not null from public.dokument where id = d1), 'alter Eintrag zeigt auf den neuen');
  perform testhilfe.pruefe((select bezeichnung = 'Bildaufnahme' from public.dokument where id = d3), 'neuer Eintrag übernimmt die Bezeichnung');
  perform testhilfe.erwarte_fehler(format('select public.dokument_ablegen(%L, %L, %L, %L, %L, p_dokument_id => %L)',
    org || '/' || dv || '/onboarding/d.pdf', h, 'onboarding', 'X', dv, d1), 'schon ersetzt');

  -- Abgelegte Datei kann nicht still verändert werden
  perform testhilfe.erwarte_fehler(format('update public.dokument set datei_hash = %L where id = %L', repeat('cd', 32), d3),
    'kann nicht geändert werden');

  -- Fehlende Datei zu einem bestehenden Eintrag ergänzen (z. B. Nachweis)
  perform testhilfe.zurueck();  -- Dokumente entstehen nur über Funktionen; hier direkt als Betreiber
  insert into public.dokument (organisation_id, dienstverhaeltnis_id, typ, kategorie, bezeichnung)
    values (org::uuid, dv, 'einzelvereinbarung', 'vereinbarung', 'Vereinbarung Stundenanpassung') returning id into dleer;
  perform testhilfe.als(hr);
  perform testhilfe.pruefe(public.dokument_ablegen(org || '/' || dv || '/vereinbarung/e.pdf', h, 'vereinbarung', null, dv,
    p_dokument_id => dleer) = dleer, 'Datei wird am bestehenden Eintrag ergänzt');
  perform testhilfe.zurueck();

  -- Studioleitung: nur Onboarding, nur eigene Studios, kein Ersetzen
  perform testhilfe.als(sl);
  d4 := public.dokument_ablegen(org || '/' || dv || '/onboarding/d.pdf', h, 'onboarding', 'Aushändigung Arbeitskleidung', dv);
  perform testhilfe.pruefe(d4 is not null, 'Studioleitung legt Onboarding-Unterlage ab');
  perform testhilfe.erwarte_fehler(format('select public.dokument_ablegen(%L, %L, %L, %L, %L)',
    org || '/' || dv || '/vereinbarung/f.pdf', h, 'vereinbarung', 'X', dv), 'nicht hochladen');
  perform testhilfe.erwarte_fehler(format('select public.dokument_ablegen(%L, %L, %L, %L, %L, p_dokument_id => %L)',
    org || '/' || dv || '/onboarding/g.pdf', h, 'onboarding', 'X', dv, d2), 'Ersetzen kann nur das Personalbüro');
  select count(*) into n from public.dokument where dienstverhaeltnis_id = dv and kategorie = 'vereinbarung';
  perform testhilfe.pruefe(n = 0, 'Studioleitung sieht keine Vereinbarungen (Entgelt)');
  select count(*) into n from public.dokument where dienstverhaeltnis_id = dv and kategorie = 'onboarding';
  perform testhilfe.pruefe(n = 4, 'Studioleitung sieht die Onboarding-Unterlagen');
  select count(*) into n from storage.objects where bucket_id = 'personalakte' and name like org || '/' || dv || '/%';
  perform testhilfe.pruefe(n = 6, 'Studioleitung sieht im Speicher nur Onboarding-Dateien');
  perform testhilfe.zurueck();

  perform testhilfe.als(sl_fremd);
  perform testhilfe.erwarte_fehler(format('select public.dokument_ablegen(%L, %L, %L, %L, %L)',
    org || '/' || dv || '/onboarding/d.pdf', h, 'onboarding', 'X', dv), 'nicht hochladen');
  select count(*) into n from public.dokument where dienstverhaeltnis_id = dv;
  perform testhilfe.pruefe(n = 0, 'Studioleitung eines anderen Studios sieht nichts');
  perform testhilfe.zurueck();

  perform testhilfe.als(buch);
  select count(*) into n from public.dokument where dienstverhaeltnis_id = dv;
  perform testhilfe.pruefe(n = 0, 'Buchhaltung (keine Dokumente) sieht nichts');
  perform testhilfe.zurueck();

  -- Speicher: nichts ändern, nichts löschen
  perform testhilfe.als(hr);
  update storage.objects set name = name || 'x' where bucket_id = 'personalakte';
  begin
    delete from storage.objects where bucket_id = 'personalakte';
  exception when others then null;
  end;
  perform testhilfe.zurueck();
  select count(*) into n from storage.objects where bucket_id = 'personalakte' and name like org || '/' || dv || '/%' and name not like '%x';
  perform testhilfe.pruefe(n = 8, 'Dateien im Speicher bleiben unverändert');
end $$;
select 'alle Tests bestanden' as ergebnis;
rollback;
