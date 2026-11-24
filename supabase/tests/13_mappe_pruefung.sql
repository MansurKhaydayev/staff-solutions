-- Korrekturen aus der Gesamtprüfung der Unterschriftsmappe
begin;
do $$
declare
  org uuid := 'de000000-0000-0000-0000-000000000001';
  hr uuid := testhilfe.benutzer('hr');
  gf uuid := testhilfe.benutzer('geschaeftsfuehrung');
  sl uuid := testhilfe.benutzer('studioleitung', array['de000000-0000-0000-0000-0000000000e1']::uuid[]);
  dv uuid; a uuid; b uuid; c uuid;
  h text := repeat('ab', 32);
  f text; n int; s jsonb;
begin
  dv := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1');
  insert into storage.objects (bucket_id, name, metadata)
  select 'personalakte', org || '/' || dv || '/' || x, '{"size":5000,"mimetype":"application/pdf"}'::jsonb
  from unnest(array['vereinbarung/a.pdf', 'unterschrift/a.png', 'vereinbarung/b.pdf', 'unterschrift/b.png',
    'vereinbarung/c.pdf', 'unterschrift/c.png', 'vereinbarung/x.pdf', 'unterschrift/falsch.png']) x;

  perform testhilfe.als(hr);
  f := public.mappe_inhalt(dv) -> 'schritte' -> 0 ->> 'fassung';
  perform testhilfe.zurueck();
  perform testhilfe.als_dienst();
  a := public.mappe_ablegen(sl, dv, 'dienstzettel', null, f, 'unterschrieben', org || '/' || dv || '/vereinbarung/a.pdf', h,
    org || '/' || dv || '/unterschrift/a.png', h, null);
  perform testhilfe.zurueck();

  -- I3: erledigter Schritt nennt Dokument und Fassung (für ein erneutes Absenden nach Netzfehler)
  perform testhilfe.als(hr);
  s := public.mappe_inhalt(dv) -> 'schritte' -> 0;
  perform testhilfe.zurueck();
  perform testhilfe.pruefe(s ->> 'status' = 'unterschrieben' and s ->> 'dokument_id' = a::text and s ->> 'fassung' = f,
    'erledigter Schritt: Dokument und Fassung');

  -- I5: Unterschriften nur über die Funktionen, nicht direkt
  perform testhilfe.als(hr);
  perform testhilfe.erwarte_fehler(format(
    'insert into public.unterschrift (organisation_id, dokument_id, rolle, name, datei_pfad) values (%L, %L, %L, %L, %L)',
    org, a, 'arbeitgeber', 'Gefälscht', org || '/' || dv || '/unterschrift/falsch.png'), 'nur über die Personalakte');
  perform testhilfe.zurueck();
  -- Selbst wenn eine fremde Zeile existiert (z. B. Altbestand): übernommen wird nur die Mitarbeiter-Unterschrift
  insert into public.unterschrift (organisation_id, dokument_id, rolle, name, datei_pfad)
    values (org, a, 'arbeitgeber', 'Gefälscht', org || '/' || dv || '/unterschrift/falsch.png');

  -- I4: Dienstzettel lässt sich nicht über „Ersetzen“ austauschen
  perform testhilfe.als(hr);
  perform testhilfe.erwarte_fehler(format('select public.dokument_ablegen(%L, %L, %L, %L, %L, p_dokument_id => %L)',
    org || '/' || dv || '/vereinbarung/x.pdf', h, 'vereinbarung', null, dv, a), 'Dienstzettel');
  perform testhilfe.zurueck();

  -- Arbeitgeber unterschreibt
  perform testhilfe.als(gf);
  f := public.arbeitgeber_inhalt(a) ->> 'fassung';
  perform testhilfe.zurueck();
  perform testhilfe.als_dienst();
  b := public.arbeitgeber_ablegen(gf, a, f, org || '/' || dv || '/vereinbarung/b.pdf', h, org || '/' || dv || '/unterschrift/b.png', h);
  perform testhilfe.zurueck();
  select count(*) into n from public.unterschrift where dokument_id = b and name = 'Gefälscht';
  perform testhilfe.pruefe(n = 0, 'fremde Unterschrift wird nicht übernommen');
  select count(*) into n from public.unterschrift where dokument_id = b;
  perform testhilfe.pruefe(n = 2, 'genau Mitarbeiter und Arbeitgeber');

  -- I3: Arbeitgeber-Inhalt nach dem Unterschreiben meldet „erledigt“ mit dem fertigen Dokument
  perform testhilfe.als(gf);
  s := public.arbeitgeber_inhalt(a);
  perform testhilfe.zurueck();
  perform testhilfe.pruefe((s ->> 'erledigt')::boolean and s ->> 'dokument_id' = b::text and s ->> 'fassung' = f,
    'Arbeitgeber: erledigt mit fertigem Dokument');

  -- I1: neu unterschreiben lassen NACH der Arbeitgeber-Unterschrift, gleicher Inhalt
  perform testhilfe.als(hr);
  perform public.dienstzettel_neu_anfordern(b, 'Unterschrift unleserlich');
  f := public.mappe_inhalt(dv) -> 'schritte' -> 0 ->> 'fassung';
  perform testhilfe.zurueck();
  perform testhilfe.als_dienst();
  c := public.mappe_ablegen(sl, dv, 'dienstzettel', null, f, 'unterschrieben', org || '/' || dv || '/vereinbarung/c.pdf', h,
    org || '/' || dv || '/unterschrift/c.png', h, null);
  perform testhilfe.zurueck();
  perform testhilfe.pruefe(c <> a and c <> b, 'neues Dokument statt der alten Fassung');
  perform testhilfe.pruefe((select ersetzt_durch = c from public.dokument where id = b), 'fertige Fassung ersetzt, bleibt erhalten');
  perform testhilfe.pruefe((select status = 'unterschrieben' from public.dokument where id = c), 'wartet wieder auf den Arbeitgeber');
end $$;
select 'alle Tests bestanden' as ergebnis;
rollback;
