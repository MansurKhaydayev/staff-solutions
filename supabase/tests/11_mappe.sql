-- Unterschriftsmappe: Inhalt je Rolle, Ablage der Mitarbeiter-Unterschrift (nur über die Edge Function),
-- Fassung, doppeltes Absenden, Ablehnung, Fristregel bei der Unterschrift
begin;
do $$
declare
  org uuid := 'de000000-0000-0000-0000-000000000001';
  hr uuid := testhilfe.benutzer('hr');
  sl uuid := testhilfe.benutzer('studioleitung', array['de000000-0000-0000-0000-0000000000e1']::uuid[]);
  sl_fremd uuid := testhilfe.benutzer('studioleitung', array['de000000-0000-0000-0000-0000000000e2']::uuid[]);
  buch uuid := testhilfe.benutzer('buchhaltung');
  dv uuid; ma uuid; dok uuid; dok2 uuid; ob uuid;
  m jsonb; dz jsonb; fassung text;
  h text := repeat('ab', 32);
  n int;
  ablegen text := 'select public.mappe_ablegen(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L)';
begin
  dv := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1');
  select mitarbeiter_id into ma from public.dienstverhaeltnis where id = dv;
  insert into storage.objects (bucket_id, name, metadata)
  select 'personalakte', org || '/' || dv || '/' || x, '{"size":5000,"mimetype":"application/pdf"}'::jsonb
  from unnest(array['vereinbarung/dz.pdf', 'vereinbarung/dz2.pdf', 'onboarding/b2.pdf', 'onboarding/b3.pdf']) x;
  insert into storage.objects (bucket_id, name, metadata)
  values ('personalakte', org || '/' || dv || '/unterschrift/u1.png', '{"size":4000,"mimetype":"image/png"}'),
         ('personalakte', org || '/' || dv || '/unterschrift/u2.png', '{"size":4000,"mimetype":"image/png"}');

  -- Inhalt je Rolle
  perform testhilfe.als(sl);
  m := public.mappe_inhalt(dv);
  perform testhilfe.pruefe(jsonb_array_length(m -> 'schritte') = 5, 'Dienstzettel + 4 Onboarding-Unterlagen');
  dz := m -> 'schritte' -> 0;
  perform testhilfe.pruefe(dz ->> 'art' = 'dienstzettel' and dz ->> 'status' = 'offen', 'erster Schritt: Dienstzettel offen');
  perform testhilfe.pruefe((dz -> 'inhalt')::text like '%1.300,00%' and (dz -> 'inhalt')::text like '%Servicekraft%',
    'Studioleitung sieht vor der Unterschrift den vollständigen Dienstzettel (Entgelt)');
  perform testhilfe.pruefe(length(dz ->> 'fassung') = 64, 'Fassung als Fingerabdruck');
  perform testhilfe.pruefe((m -> 'schritte' -> 2 -> 'inhalt' -> 'abschnitte' -> 0 ->> 'text') like '%Fotos%', 'Bildaufnahme-Text');
  fassung := dz ->> 'fassung';
  perform testhilfe.zurueck();
  perform testhilfe.als(sl_fremd);
  perform testhilfe.erwarte_fehler(format('select public.mappe_inhalt(%L)', dv), 'Keine Berechtigung');
  perform testhilfe.zurueck();
  perform testhilfe.als(buch);
  perform testhilfe.erwarte_fehler(format('select public.mappe_inhalt(%L)', dv), 'Keine Berechtigung');
  perform testhilfe.zurueck();

  -- Nur die Edge Function (service_role) darf ablegen
  perform testhilfe.als(sl);
  perform testhilfe.erwarte_fehler(format(ablegen, sl, dv, 'dienstzettel', null, fassung, 'unterschrieben',
    org || '/' || dv || '/vereinbarung/dz.pdf', h, org || '/' || dv || '/unterschrift/u1.png', h, null), 'permission denied');
  perform testhilfe.zurueck();

  -- Falsche Fassung (Prüfschwerpunkt 1)
  perform testhilfe.als_dienst();
  perform testhilfe.erwarte_fehler(format(ablegen, sl, dv, 'dienstzettel', null, repeat('0', 64), 'unterschrieben',
    org || '/' || dv || '/vereinbarung/dz.pdf', h, org || '/' || dv || '/unterschrift/u1.png', h, null),
    'Die Daten wurden geändert. Bitte die Mappe neu öffnen.');
  -- Richtige Fassung
  dok := public.mappe_ablegen(sl, dv, 'dienstzettel', null, fassung, 'unterschrieben',
    org || '/' || dv || '/vereinbarung/dz.pdf', h, org || '/' || dv || '/unterschrift/u1.png', h, null);
  -- Doppelt abgeschickt (Prüfschwerpunkt 2)
  dok2 := public.mappe_ablegen(sl, dv, 'dienstzettel', null, fassung, 'unterschrieben',
    org || '/' || dv || '/vereinbarung/dz2.pdf', h, org || '/' || dv || '/unterschrift/u2.png', h, null);
  perform testhilfe.zurueck();
  perform testhilfe.pruefe(dok = dok2, 'zweites Absenden liefert dasselbe Dokument');
  perform testhilfe.pruefe((select status = 'unterschrieben' and typ = 'dienstzettel' and kategorie = 'vereinbarung'
    and inhalt_hash = fassung and inhalt is not null and hochgeladen_von = sl from public.dokument where id = dok), 'Dienstzettel abgelegt');
  select count(*) into n from public.unterschrift where dokument_id = dok and rolle = 'mitarbeiter' and name = 'Test Person'
    and ort is not null and datei_pfad like '%/unterschrift/u1.png';
  perform testhilfe.pruefe(n = 1, 'genau eine Unterschrift des Mitarbeiters');

  -- Danach: erledigt, ohne Inhalt; Studioleitung sieht das PDF nicht mehr
  perform testhilfe.als(sl);
  m := public.mappe_inhalt(dv);
  perform testhilfe.pruefe(m -> 'schritte' -> 0 ->> 'status' = 'unterschrieben' and not (m -> 'schritte' -> 0 ? 'inhalt'),
    'nach der Unterschrift kein Inhalt mehr');
  select count(*) into n from public.dokument where id = dok;
  perform testhilfe.pruefe(n = 0, 'Studioleitung sieht den unterschriebenen Dienstzettel nicht');

  -- Onboarding ablehnen (Pflicht) → Klärung, keine Unterschrift
  perform testhilfe.zurueck();
  perform testhilfe.als_dienst();
  ob := public.mappe_ablegen(sl, dv, 'onboarding', 'de000000-0000-0000-0000-0000000000b2',
    (select s ->> 'fassung' from jsonb_array_elements(m -> 'schritte') s where s ->> 'unterlage_id' = 'de000000-0000-0000-0000-0000000000b2'),
    'abgelehnt', org || '/' || dv || '/onboarding/b2.pdf', h, null, null, null);
  perform testhilfe.zurueck();
  perform testhilfe.pruefe((select status = 'abgelehnt' and onboarding_ergebnis = 'abgelehnt' from public.dokument where id = ob), 'Ablehnung abgelegt');
  perform testhilfe.pruefe(not exists (select 1 from public.unterschrift where dokument_id = ob), 'keine Unterschrift bei Ablehnung');
  perform testhilfe.pruefe(exists (select 1 from public.onboarding_klaerung where dienstverhaeltnis_id = dv and geschlossen_am is null),
    'abgelehnte Pflichtunterlage öffnet Klärung');

  -- Fassung passt nach einer Stammdatenänderung nicht mehr
  perform testhilfe.als(sl);
  m := public.mappe_inhalt(dv);
  fassung := (select s ->> 'fassung' from jsonb_array_elements(m -> 'schritte') s where s ->> 'unterlage_id' = 'de000000-0000-0000-0000-0000000000b3');
  perform testhilfe.zurueck();
  perform testhilfe.als(hr);
  perform public.stammdaten_aendern(ma, '{"nachname": "Neumann"}', current_date, 'Heirat');
  perform testhilfe.zurueck();
  perform testhilfe.als_dienst();
  perform testhilfe.erwarte_fehler(format(ablegen, sl, dv, 'onboarding', 'de000000-0000-0000-0000-0000000000b3', fassung, 'unterschrieben',
    org || '/' || dv || '/onboarding/b3.pdf', h, org || '/' || dv || '/unterschrift/u2.png', h, null), 'Die Daten wurden geändert');
  perform testhilfe.zurueck();
end $$;
rollback;
-- Fristregel bei der Unterschrift: Dienstzettel ohne Dringend-Vermerk, Dienstantritt inzwischen zu knapp
begin;
do $$
declare
  org uuid := 'de000000-0000-0000-0000-000000000001';
  hr uuid := testhilfe.benutzer('hr');
  dv uuid; fassung text;
  h text := repeat('ab', 32);
begin
  dv := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1');
  update public.dienstverhaeltnis set dringend_grund = null, dringend_von = null, dringend_am = null where id = dv;
  insert into storage.objects (bucket_id, name, metadata)
  values ('personalakte', org || '/' || dv || '/vereinbarung/dz.pdf', '{"size":5000,"mimetype":"application/pdf"}'),
         ('personalakte', org || '/' || dv || '/unterschrift/u1.png', '{"size":4000,"mimetype":"image/png"}');
  perform testhilfe.als(hr);
  fassung := public.mappe_inhalt(dv) -> 'schritte' -> 0 ->> 'fassung';
  perform testhilfe.zurueck();
  perform testhilfe.als_dienst();
  perform testhilfe.erwarte_fehler(format('select public.mappe_ablegen(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L)',
    hr, dv, 'dienstzettel', null, fassung, 'unterschrieben', org || '/' || dv || '/vereinbarung/dz.pdf', h,
    org || '/' || dv || '/unterschrift/u1.png', h, null), 'FRIST: Zu kurzfristig');
  perform public.mappe_ablegen(hr, dv, 'dienstzettel', null, fassung, 'unterschrieben', org || '/' || dv || '/vereinbarung/dz.pdf', h,
    org || '/' || dv || '/unterschrift/u1.png', h, 'Personalmangel');
  perform testhilfe.zurueck();
  perform testhilfe.pruefe((select dringend_grund = 'Personalmangel' and dringend_von = hr from public.dienstverhaeltnis where id = dv),
    'dringend bei der Unterschrift vermerkt');
end $$;
select 'alle Tests bestanden' as ergebnis;
rollback;
