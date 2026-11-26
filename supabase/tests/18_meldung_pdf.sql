-- PDFs für den Lohnverrechner: Inhalt, Rechte, Korrektur, erneuter Aufruf
begin;
do $$
declare
  org uuid := 'de000000-0000-0000-0000-000000000001';
  hr uuid := testhilfe.benutzer('hr');
  sl uuid := testhilfe.benutzer('studioleitung', array['de000000-0000-0000-0000-0000000000e1']::uuid[]);
  heute date := app.heute_wien();
  h text := repeat('ab', 32);
  dv uuid; m uuid; i jsonb; d uuid; d2 uuid; t text;
begin
  dv := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1');
  update public.dienstverhaeltnis set eintritt = heute - 30 where id = dv;
  perform testhilfe.als(hr);
  m := public.austritt_melden(dv, 'austritt', heute, 'probezeit', null, true);
  i := public.meldung_inhalt(m);
  perform testhilfe.zurueck();
  perform testhilfe.pruefe(i ->> 'typ' = 'austrittsmeldung' and i ->> 'kategorie' = 'abmeldung', 'Austrittsmeldung');
  perform testhilfe.pruefe(i -> 'inhalt' ->> 'titel' = 'AUSTRITTSMELDUNG', 'Titel');
  t := (i -> 'inhalt' -> 'felder')::text;
  perform testhilfe.pruefe(position(to_char(heute, 'DD.MM.YYYY') in t) > 0 and position('Lösung in der Probezeit' in t) > 0
    and position('1238010190' in t) > 0, 'Felder: Datum, Art, Versicherungsnummer');
  perform testhilfe.pruefe(i ->> 'fassung' = app.fassung(i -> 'inhalt'), 'Fassung = Fingerabdruck des Inhalts');

  -- Leitung darf nicht
  perform testhilfe.als(sl);
  perform testhilfe.erwarte_fehler(format('select public.meldung_inhalt(%L)', m), 'Das darf nur das Personalbüro.');
  perform testhilfe.zurueck();
  -- nur die Edge Function darf ablegen
  perform testhilfe.als(hr);
  perform testhilfe.erwarte_fehler(format('select public.meldung_ablegen(%L, %L, %L, %L, %L)', hr, m, i ->> 'fassung', 'x', h), '');
  perform testhilfe.zurueck();

  -- Ablegen als Dienst, falscher Ort, falsche Fassung, doppelter Aufruf
  insert into storage.objects (bucket_id, name, metadata) values
    ('personalakte', org || '/' || dv || '/abmeldung/a.pdf', '{"size":4000,"mimetype":"application/pdf"}'),
    ('personalakte', org || '/' || dv || '/vereinbarung/a.pdf', '{"size":4000,"mimetype":"application/pdf"}'),
    ('personalakte', org || '/' || dv || '/abmeldung/k.pdf', '{"size":4000,"mimetype":"application/pdf"}');
  perform testhilfe.als_dienst();
  perform testhilfe.erwarte_fehler(format('select public.meldung_ablegen(%L, %L, %L, %L, %L)', hr, m, i ->> 'fassung',
    org || '/' || dv || '/vereinbarung/a.pdf', h), 'Der Ablageort des PDF passt nicht.');
  perform testhilfe.erwarte_fehler(format('select public.meldung_ablegen(%L, %L, %L, %L, %L)', hr, m, 'alt',
    org || '/' || dv || '/abmeldung/a.pdf', h), 'Die Daten wurden geändert.');
  perform testhilfe.erwarte_fehler(format('select public.meldung_ablegen(%L, %L, %L, %L, %L)', sl, m, i ->> 'fassung',
    org || '/' || dv || '/abmeldung/a.pdf', h), 'Das darf nur das Personalbüro.');
  d := public.meldung_ablegen(hr, m, i ->> 'fassung', org || '/' || dv || '/abmeldung/a.pdf', h);
  d2 := public.meldung_ablegen(hr, m, i ->> 'fassung', org || '/' || dv || '/abmeldung/a.pdf', h);
  perform testhilfe.zurueck();
  perform testhilfe.pruefe(d = d2, 'doppelter Aufruf: dasselbe Dokument');
  perform testhilfe.pruefe((select typ = 'austrittsmeldung' and kategorie = 'abmeldung' and austritt_meldung_id = m
    and bezeichnung = 'Austrittsmeldung' from public.dokument where id = d), 'Dokument eingetragen');
  perform testhilfe.pruefe(app.dv_status(dv) = 'austritt_bestaetigt', 'Meldungs-PDF ändert den Status nicht');

  -- übermitteln, dann Datum korrigieren → Korrektur mit bisher/neu
  perform testhilfe.als(hr);
  perform public.uebermittlung_vermerken(array[d]);
  m := public.austritt_korrigieren(m, 'Tippfehler', heute + 2);
  i := public.meldung_inhalt(m);
  perform testhilfe.zurueck();
  perform testhilfe.pruefe(i ->> 'typ' = 'korrekturmeldung' and i ->> 'kategorie' = 'abmeldung', 'Korrektur');
  t := (i -> 'inhalt' -> 'felder')::text;
  perform testhilfe.pruefe(position('Bisher gemeldet' in t) > 0 and position(to_char(heute + 2, 'DD.MM.YYYY') in t) > 0
    and position('Tippfehler' in t) > 0, 'Korrektur: bisher, neu, Grund');
  perform testhilfe.als_dienst();
  d := public.meldung_ablegen(hr, m, i ->> 'fassung', org || '/' || dv || '/abmeldung/k.pdf', h);
  perform testhilfe.zurueck();
  perform testhilfe.pruefe((select typ from public.dokument where id = d) = 'korrekturmeldung', 'Korrektur-PDF eingetragen');
  perform testhilfe.als(hr);
  perform testhilfe.pruefe((select dokument_id from public.uebermittlung_offen() where dienstverhaeltnis_id = dv) = d, 'Korrektur auf der Liste');
  perform testhilfe.zurueck();
end $$;
select 'ok' as ergebnis;
rollback;
