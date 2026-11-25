-- Kleinigkeiten aus der Prüfung: „angemeldet“ nur in der eigenen Firma, Hinweis bei geänderten Daten
begin;
do $$
declare
  org uuid := 'de000000-0000-0000-0000-000000000001';
  org2 uuid := gen_random_uuid();
  fremd uuid := gen_random_uuid();
  hr uuid := testhilfe.benutzer('hr');
  gf uuid := testhilfe.benutzer('geschaeftsfuehrung');
  sl uuid := testhilfe.benutzer('studioleitung', array['de000000-0000-0000-0000-0000000000e1']::uuid[]);
  dv uuid; dv2 uuid; ma uuid; dz uuid; dz2 uuid;
  h text := repeat('ab', 32);
  f text; a jsonb;
begin
  -- Zweite Firma mit einer HR-Person
  insert into public.organisation (id, name) values (org2, 'Fremde Test GmbH');
  insert into auth.users (id, email, aud, role) values (fremd, 'fremd-' || left(fremd::text, 8) || '@test.invalid', 'authenticated', 'authenticated');
  insert into public.profil (user_id, organisation_id, rolle) values (fremd, org2, 'hr');

  -- I. angemeldet nur für die eigene Firma
  dv := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1');
  insert into storage.objects (bucket_id, name, metadata)
  values ('personalakte', org || '/' || dv || '/anmeldung/a.pdf', '{"size":1000,"mimetype":"application/pdf"}');
  perform testhilfe.als(hr);
  perform public.dokument_ablegen(org || '/' || dv || '/anmeldung/a.pdf', h, 'anmeldung', 'Anmeldung ÖGK', dv);
  perform testhilfe.pruefe(app.angemeldet(dv), 'eigene Firma: angemeldet');
  perform testhilfe.pruefe((public.akte_kopf(dv) ->> 'angemeldet')::boolean, 'Akte: angemeldet');
  perform testhilfe.pruefe((select angemeldet from public.mitarbeiter_verzeichnis() where dienstverhaeltnis_id = dv), 'Verzeichnis: angemeldet');
  perform testhilfe.zurueck();
  perform testhilfe.als(fremd);
  perform testhilfe.pruefe(app.angemeldet(dv) is false, 'fremde Firma: kein „angemeldet“ für Mitarbeiter anderer Firmen');
  perform testhilfe.zurueck();

  -- II. Hinweis bei geänderten Daten seit der Mitarbeiter-Unterschrift
  dv2 := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1');
  select mitarbeiter_id into ma from public.dienstverhaeltnis where id = dv2;
  insert into storage.objects (bucket_id, name, metadata)
  select 'personalakte', org || '/' || dv2 || '/' || x, '{"size":5000,"mimetype":"application/pdf"}'::jsonb
  from unnest(array['vereinbarung/m.pdf', 'unterschrift/m.png']) x;

  -- Änderung VOR der Unterschrift zählt nicht
  perform testhilfe.als(hr);
  perform public.stammdaten_aendern(ma, '{"telefon": "+43 660 7654321"}', current_date, 'Neue Nummer');
  perform testhilfe.zurueck();
  update public.stammdaten_aenderung set created_at = now() - interval '2 hours' where mitarbeiter_id = ma;

  perform testhilfe.als(hr);
  f := public.mappe_inhalt(dv2) -> 'schritte' -> 0 ->> 'fassung';
  perform testhilfe.zurueck();
  perform testhilfe.als_dienst();
  dz := public.mappe_ablegen(sl, dv2, 'dienstzettel', null, f, 'unterschrieben', org || '/' || dv2 || '/vereinbarung/m.pdf', h,
    org || '/' || dv2 || '/unterschrift/m.png', h, null);
  perform testhilfe.zurueck();
  -- Die Unterschrift liegt eine Stunde zurück (alles hier läuft in einer Transaktion mit derselben Uhrzeit)
  update public.unterschrift set zeitpunkt = now() - interval '1 hour' where dokument_id = dz;

  perform testhilfe.als(gf);
  a := public.arbeitgeber_inhalt(dz);
  perform testhilfe.pruefe((a ->> 'geaendert')::boolean is false and a -> 'geaenderte_felder' = '[]'::jsonb,
    'ohne Änderung seit der Unterschrift: kein Hinweis (Änderung davor zählt nicht)');
  perform testhilfe.pruefe((select not h.geaendert from public.arbeitgeber_offen_hinweise() h where h.dokument_id = dz),
    'Liste: ohne Änderung kein Hinweis');
  perform testhilfe.zurueck();

  -- Straße geändert
  perform testhilfe.als(hr);
  perform public.stammdaten_aendern(ma, '{"strasse": "Neue Gasse 2"}', current_date, 'Umzug');
  perform testhilfe.zurueck();
  perform testhilfe.als(gf);
  a := public.arbeitgeber_inhalt(dz);
  perform testhilfe.pruefe((a ->> 'geaendert')::boolean and a -> 'geaenderte_felder' = '["Straße"]'::jsonb,
    'Straße geändert: Hinweis nennt „Straße“ (bekommen: ' || (a -> 'geaenderte_felder')::text || ')');
  perform testhilfe.pruefe((select h.geaendert and h.geaenderte_felder = array['Straße'] from public.arbeitgeber_offen_hinweise() h
    where h.dokument_id = dz), 'Liste: Straße geändert');
  perform testhilfe.zurueck();

  -- IBAN zusätzlich (steht nicht auf dem Dienstzettel), Straße noch einmal: jedes Feld nur einmal, feste Reihenfolge
  perform testhilfe.als(hr);
  perform public.stammdaten_aendern(ma, '{"iban": "DE89 3704 0044 0532 0130 00"}', current_date, 'Bankwechsel');
  perform public.stammdaten_aendern(ma, '{"strasse": "Andere Gasse 3"}', current_date, 'Tippfehler');
  perform testhilfe.zurueck();
  perform testhilfe.als(gf);
  a := public.arbeitgeber_inhalt(dz);
  perform testhilfe.pruefe(a -> 'geaenderte_felder' = '["Straße", "IBAN"]'::jsonb,
    'Straße und IBAN, ohne Doppelte (bekommen: ' || (a -> 'geaenderte_felder')::text || ')');
  -- Der unterschriebene Inhalt selbst bleibt unverändert
  perform testhilfe.pruefe(a ->> 'fassung' = f and app.fassung(a -> 'inhalt') = f, 'unterschriebener Stand bleibt erhalten');
  perform testhilfe.zurueck();

  -- Vertragstexte geändert (Textbaustein), ohne Stammdatenänderung
  dv := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1');
  insert into storage.objects (bucket_id, name, metadata)
  select 'personalakte', org || '/' || dv || '/' || x, '{"size":5000,"mimetype":"application/pdf"}'::jsonb
  from unnest(array['vereinbarung/m.pdf', 'unterschrift/m.png']) x;
  perform testhilfe.als(hr);
  f := public.mappe_inhalt(dv) -> 'schritte' -> 0 ->> 'fassung';
  perform testhilfe.zurueck();
  perform testhilfe.als_dienst();
  dz2 := public.mappe_ablegen(sl, dv, 'dienstzettel', null, f, 'unterschrieben', org || '/' || dv || '/vereinbarung/m.pdf', h,
    org || '/' || dv || '/unterschrift/m.png', h, null);
  perform testhilfe.zurueck();
  update public.textbaustein set text = text || ' (geändert)'
  where id = (select id from public.textbaustein where organisation_id = org and aktiv and gesellschaft_id is null order by reihenfolge limit 1);
  perform testhilfe.als(gf);
  a := public.arbeitgeber_inhalt(dz2);
  perform testhilfe.pruefe(a -> 'geaenderte_felder' = '["Vertragstexte"]'::jsonb,
    'Textbaustein geändert: „Vertragstexte“ (bekommen: ' || (a -> 'geaenderte_felder')::text || ')');
  perform testhilfe.zurueck();

  -- Rechte: ohne Arbeitgeber-Recht keine Hinweise
  perform testhilfe.als(hr);
  perform testhilfe.erwarte_fehler('select * from public.arbeitgeber_offen_hinweise()', 'Keine Berechtigung');
  perform testhilfe.erwarte_fehler(format('select public.arbeitgeber_inhalt(%L)', dz), 'Keine Berechtigung');
  perform testhilfe.zurueck();
  perform testhilfe.als(fremd);
  perform testhilfe.pruefe(cardinality(app.dienstzettel_aenderungen(dz)) = 0, 'fremde Firma sieht keine Änderungen (Zeilenrechte)');
  perform testhilfe.zurueck();
end $$;
select 'alle Tests bestanden' as ergebnis;
rollback;
