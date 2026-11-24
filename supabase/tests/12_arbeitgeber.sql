-- Arbeitgeber-Unterschrift, neu unterschreiben lassen, übermittelt/ausgehändigt, Papier, offene Punkte
begin;
do $$
declare
  org uuid := 'de000000-0000-0000-0000-000000000001';
  hr uuid := testhilfe.benutzer('hr');
  gf uuid := testhilfe.benutzer('geschaeftsfuehrung');
  sl uuid := testhilfe.benutzer('studioleitung', array['de000000-0000-0000-0000-0000000000e1']::uuid[]);
  dv uuid; dv2 uuid; dv3 uuid; dz uuid; dz2 uuid; neu uuid; pap uuid;
  h text := repeat('ab', 32);
  f text; n int;
  ag text := 'select public.arbeitgeber_ablegen(%L, %L, %L, %L, %L, %L, %L)';
begin
  dv := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1');
  dv2 := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1');
  update public.dienstverhaeltnis set dringend_grund = null where id = dv2;
  dv3 := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1');
  insert into storage.objects (bucket_id, name, metadata)
  select 'personalakte', org || '/' || x, '{"size":5000,"mimetype":"application/pdf"}'::jsonb
  from unnest(array[dv || '/vereinbarung/m.pdf', dv || '/unterschrift/m.png', dv || '/vereinbarung/ag.pdf', dv || '/unterschrift/ag.png',
    dv2 || '/vereinbarung/m.pdf', dv2 || '/unterschrift/m.png', dv2 || '/vereinbarung/m2.pdf', dv2 || '/unterschrift/m2.png', dv3 || '/vereinbarung/papier.pdf']) x;

  -- Mitarbeiter unterschreiben (über die Edge-Function-Funktion)
  perform testhilfe.als(hr);
  f := public.mappe_inhalt(dv) -> 'schritte' -> 0 ->> 'fassung';
  perform testhilfe.pruefe(public.mappe_inhalt(dv) ->> 'organisation_id' = org::text and public.mappe_inhalt(dv) ->> 'ort' is not null,
    'Mappe: Organisation und Ort für die Edge Function');
  perform testhilfe.zurueck();
  perform testhilfe.als_dienst();
  dz := public.mappe_ablegen(sl, dv, 'dienstzettel', null, f, 'unterschrieben', org || '/' || dv || '/vereinbarung/m.pdf', h,
    org || '/' || dv || '/unterschrift/m.png', h, null);
  perform testhilfe.zurueck();
  perform testhilfe.als(hr);
  f := public.mappe_inhalt(dv2) -> 'schritte' -> 0 ->> 'fassung';
  perform testhilfe.zurueck();
  perform testhilfe.als_dienst();
  dz2 := public.mappe_ablegen(sl, dv2, 'dienstzettel', null, f, 'unterschrieben', org || '/' || dv2 || '/vereinbarung/m.pdf', h,
    org || '/' || dv2 || '/unterschrift/m.png', h, 'Personalmangel');
  perform testhilfe.zurueck();
  -- dv gilt ab hier als regulär (Dienstantritt später, keine dringende Anmeldung)
  update public.dienstverhaeltnis set dringend_grund = null, eintritt = current_date + 7 where id = dv;

  -- Liste „Zu unterschreiben“ nur mit Recht; dringend zuerst
  perform testhilfe.als(hr);
  perform testhilfe.erwarte_fehler('select * from public.arbeitgeber_offen()', 'Keine Berechtigung');
  perform testhilfe.zurueck();
  perform testhilfe.als(gf);
  perform testhilfe.pruefe((select array_agg(dokument_id order by nr) from public.arbeitgeber_offen() with ordinality as t(dokument_id, dienstverhaeltnis_id, vorname, nachname, arbeitsort, eintritt, unterschrieben_am, dringend_grund, pdf_pfad, nr)
    where dienstverhaeltnis_id in (dv, dv2)) = array[dz2, dz], 'GF sieht beide Dienstzettel, dringend zuerst');
  perform testhilfe.pruefe((public.arbeitgeber_inhalt(dz) ->> 'fassung') is not null
    and public.arbeitgeber_inhalt(dz) -> 'mitarbeiter' ->> 'png_pfad' like '%/unterschrift/m.png', 'Inhalt für die Arbeitgeber-Unterschrift');
  f := public.arbeitgeber_inhalt(dz) ->> 'fassung';
  perform testhilfe.pruefe(public.arbeitgeber_inhalt(dz) ->> 'organisation_id' = org::text
    and public.arbeitgeber_inhalt(dz) ->> 'dienstverhaeltnis_id' = dv::text, 'Arbeitgeber: Ablageort für die Edge Function');
  perform testhilfe.zurueck();

  -- Ablegen: nur service_role, nur mit Recht
  perform testhilfe.als_dienst();
  perform testhilfe.erwarte_fehler(format(ag, hr, dz, f, org || '/' || dv || '/vereinbarung/ag.pdf', h, org || '/' || dv || '/unterschrift/ag.png', h),
    'Keine Berechtigung');
  perform testhilfe.erwarte_fehler(format(ag, gf, dz, repeat('0', 64), org || '/' || dv || '/vereinbarung/ag.pdf', h, org || '/' || dv || '/unterschrift/ag.png', h),
    'Die Daten wurden geändert');
  neu := public.arbeitgeber_ablegen(gf, dz, f, org || '/' || dv || '/vereinbarung/ag.pdf', h, org || '/' || dv || '/unterschrift/ag.png', h);
  perform testhilfe.pruefe(public.arbeitgeber_ablegen(gf, dz, f, org || '/' || dv || '/vereinbarung/ag.pdf', h,
    org || '/' || dv || '/unterschrift/ag.png', h) = neu, 'zweites Absenden liefert dasselbe Dokument');
  perform testhilfe.zurueck();
  perform testhilfe.pruefe((select status = 'abgeschlossen' and inhalt_hash = f from public.dokument where id = neu), 'abgeschlossen');
  perform testhilfe.pruefe((select ersetzt_durch = neu from public.dokument where id = dz), 'erste Fassung ersetzt, bleibt erhalten');
  select count(*) into n from public.unterschrift where dokument_id = neu;
  perform testhilfe.pruefe(n = 2, 'beide Unterschriften am fertigen Dokument');
  perform testhilfe.pruefe(exists (select 1 from public.unterschrift where dokument_id = dz and rolle = 'mitarbeiter'),
    'ursprüngliche Mitarbeiter-Unterschrift bleibt am ersten Dokument');

  -- Neu unterschreiben lassen (Prüfschwerpunkt 5)
  perform testhilfe.als(sl);
  perform testhilfe.erwarte_fehler(format('select public.dienstzettel_neu_anfordern(%L, %L)', dz2, 'x'), 'Personalbüro');
  perform testhilfe.zurueck();
  perform testhilfe.als(hr);
  perform testhilfe.erwarte_fehler(format('select public.dienstzettel_neu_anfordern(%L, %L)', dz2, ' '), 'Bitte einen Grund');
  perform public.dienstzettel_neu_anfordern(dz2, 'Adresse falsch');
  perform testhilfe.pruefe((public.mappe_inhalt(dv2) -> 'schritte' -> 0 ->> 'status') = 'offen', 'Mappe bietet den Dienstzettel wieder an');
  perform testhilfe.zurueck();
  perform testhilfe.pruefe((select status = 'abgelehnt' and neu_angefordert_grund = 'Adresse falsch' from public.dokument where id = dz2),
    'zurückgewiesen vor der Arbeitgeber-Unterschrift');
  f := (select inhalt_hash from public.dokument where id = dz2);
  perform testhilfe.als_dienst();
  perform testhilfe.erwarte_fehler(format(ag, gf, dz2, f, org || '/' || dv2 || '/vereinbarung/m.pdf', h, org || '/' || dv2 || '/unterschrift/m.png', h),
    'wird neu erstellt');
  perform testhilfe.zurueck();

  -- Übermittelt / ausgehändigt
  perform testhilfe.als(hr);
  perform testhilfe.erwarte_fehler(format('select public.dienstzettel_vermerken(%L, %L)', dz2, 'uebermittelt'), 'noch nicht abgeschlossen');
  perform public.dienstzettel_vermerken(neu, 'uebermittelt');
  perform testhilfe.erwarte_fehler(format('select public.dienstzettel_vermerken(%L, %L, %L)', neu, 'ausgehaendigt', 'fax'), 'Ausdruck oder E-Mail');
  perform public.dienstzettel_vermerken(neu, 'ausgehaendigt', 'email');
  perform testhilfe.zurueck();
  perform testhilfe.pruefe((select uebermittelt_am is not null and uebermittelt_von = hr and ausgehaendigt_art = 'email'
    from public.dokument where id = neu), 'übermittelt und ausgehändigt vermerkt');

  -- Papier-Dienstzettel als Notlösung
  perform testhilfe.als(hr);
  pap := public.dienstzettel_papier(org || '/' || dv3 || '/vereinbarung/papier.pdf', h, dv3);
  perform testhilfe.pruefe((public.mappe_inhalt(dv3) -> 'schritte' -> 0 ->> 'status') = 'abgeschlossen', 'Papier zählt als erledigt');
  perform testhilfe.zurueck();
  perform testhilfe.pruefe((select papier and typ = 'dienstzettel' and status = 'abgeschlossen' from public.dokument where id = pap),
    'Papier gekennzeichnet');
  perform testhilfe.als(sl);
  perform testhilfe.erwarte_fehler(format('select public.dienstzettel_papier(%L, %L, %L)', org || '/' || dv3 || '/vereinbarung/papier.pdf', h, dv3),
    'Personalbüro');
  perform testhilfe.zurueck();

  -- Offene Punkte je Rolle
  perform testhilfe.als(sl);
  perform testhilfe.pruefe(exists (select 1 from public.offene_punkte() where dienstverhaeltnis_id = dv2 and art = 'dienstzettel'
    and beschreibung = 'Dienstzettel neu unterschreiben lassen'), 'Leitung: neu unterschreiben lassen');
  perform testhilfe.pruefe(not exists (select 1 from public.offene_punkte() where art in ('arbeitgeber', 'uebermittlung', 'dringend')),
    'Leitung sieht keine Büro-Punkte');
  perform testhilfe.zurueck();
  perform testhilfe.als(hr);
  perform testhilfe.pruefe(exists (select 1 from public.offene_punkte() where dienstverhaeltnis_id = dv3 and art = 'uebermittlung'),
    'Büro: Papier-Dienstzettel noch übermitteln');
  perform testhilfe.pruefe(exists (select 1 from public.offene_punkte() where dienstverhaeltnis_id = dv2 and art = 'dringend'
    and beschreibung = 'Dringende Anmeldung: Personalmangel'), 'Büro: dringende Anmeldung');
  perform testhilfe.pruefe(not exists (select 1 from public.offene_punkte() where art = 'arbeitgeber'), 'HR ohne Arbeitgeber-Recht');
  perform testhilfe.zurueck();
  perform testhilfe.als(gf);
  perform testhilfe.pruefe(not exists (select 1 from public.offene_punkte() where dienstverhaeltnis_id = dv
    and art in ('dienstzettel', 'arbeitgeber', 'uebermittlung')), 'GF: fertig unterschrieben und übermittelt, nichts mehr offen');
  perform testhilfe.zurueck();

  -- Erneut unterschreiben nach „neu unterschreiben lassen“ (gleicher Inhalt) legt ein neues Dokument an
  perform testhilfe.als(hr);
  f := public.mappe_inhalt(dv2) -> 'schritte' -> 0 ->> 'fassung';
  perform testhilfe.zurueck();
  perform testhilfe.als_dienst();
  neu := public.mappe_ablegen(sl, dv2, 'dienstzettel', null, f, 'unterschrieben', org || '/' || dv2 || '/vereinbarung/m2.pdf', h,
    org || '/' || dv2 || '/unterschrift/m2.png', h, null);
  perform testhilfe.zurueck();
  perform testhilfe.pruefe(neu <> dz2 and (select ersetzt_durch = neu from public.dokument where id = dz2),
    'neue Unterschrift ersetzt die zurückgewiesene Fassung');
end $$;
select 'alle Tests bestanden' as ergebnis;
rollback;
