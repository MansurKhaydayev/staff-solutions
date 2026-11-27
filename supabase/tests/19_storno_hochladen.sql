-- Storno-Bestätigung über die normale Ablage hochladen → Status „nicht angetreten“
begin;
do $$
declare
  org uuid := 'de000000-0000-0000-0000-000000000001';
  hr uuid := testhilfe.benutzer('hr');
  sl uuid := testhilfe.benutzer('studioleitung', array['de000000-0000-0000-0000-0000000000e1']::uuid[]);
  dv uuid; m uuid; x uuid;
  h text := repeat('cd', 32);
begin
  dv := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1');
  insert into public.austritt_meldung (organisation_id, dienstverhaeltnis_id, art, notiz, gemeldet_von, bestaetigt_von, bestaetigt_am)
    values (org, dv, 'nicht_angetreten', 'nicht erschienen', hr, hr, now()) returning id into m;
  insert into public.dokument (organisation_id, dienstverhaeltnis_id, typ, kategorie, bezeichnung, status, datei_pfad)
    values (org, dv, 'anmeldebestaetigung', 'anmeldung', 'Anmeldung', 'abgeschlossen', org || '/' || dv || '/anmeldung/a.pdf');
  perform testhilfe.pruefe(app.dv_status(dv) = 'storno_ausstaendig', 'vorher: Storno ausständig');

  insert into storage.objects (bucket_id, name, metadata)
  values ('personalakte', org || '/' || dv || '/storno/s.pdf', '{"size":2048,"mimetype":"application/pdf"}'),
         ('personalakte', org || '/' || dv || '/storno/t.pdf', '{"size":2048,"mimetype":"application/pdf"}');

  -- Leitung darf keine Storno-Bestätigung ablegen
  perform testhilfe.als(sl);
  perform testhilfe.erwarte_fehler(format('select public.dokument_ablegen(%L, %L, %L, %L, %L)',
    org || '/' || dv || '/storno/t.pdf', h, 'storno', 'Storno', dv), 'Diese Unterlage darfst du hier nicht hochladen.');
  perform testhilfe.zurueck();

  perform testhilfe.als(hr);
  x := public.dokument_ablegen(org || '/' || dv || '/storno/s.pdf', h, 'storno', 'Storno-Bestätigung', dv);
  perform testhilfe.zurueck();
  perform testhilfe.pruefe((select kategorie = 'storno' and datei_hash = h from public.dokument where id = x), 'Storno-Bestätigung abgelegt');
  perform testhilfe.pruefe(app.dv_status(dv) = 'nicht_angetreten', 'nachher: nicht angetreten');
end $$;
rollback;
