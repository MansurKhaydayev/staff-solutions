-- Funde aus der unabhängigen Prüfung: Datenschutz, neue Abmeldung nach Rücknahme, veraltete PDFs,
-- alte Bestätigungen, Storno-Regel, Korrektur nur nach Bestätigung
begin;
do $$
declare
  org uuid := 'de000000-0000-0000-0000-000000000001';
  hr uuid := testhilfe.benutzer('hr');
  sl uuid := testhilfe.benutzer('studioleitung', array['de000000-0000-0000-0000-0000000000e1']::uuid[]);
  verw uuid := testhilfe.benutzer('verwaltung');
  heute date := app.heute_wien();
  dv uuid; dv2 uuid; m uuid; m2 uuid; pdf uuid; pdf_alt uuid; pdf_neu uuid; n int; t text;
begin
  dv := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1');
  update public.dienstverhaeltnis set eintritt = heute - 60 where id = dv;

  -- 1. Notiz und Art nicht direkt aus der Tabelle lesbar (nur Büro)
  perform testhilfe.als(sl);
  m := public.austritt_melden(dv, 'austritt', heute + 5, 'entlassung', 'GEHEIME NOTIZ');
  select count(*) into n from public.austritt_meldung where dienstverhaeltnis_id = dv;
  perform testhilfe.pruefe(n = 0, 'Leitung liest die Tabelle nicht direkt');
  perform testhilfe.zurueck();
  perform testhilfe.als(verw);
  select count(*) into n from public.austritt_meldung where dienstverhaeltnis_id = dv;
  perform testhilfe.pruefe(n = 0, 'Verwaltung liest die Tabelle nicht direkt');
  perform testhilfe.pruefe((select notiz from public.austritt_verlauf(dv) limit 1) is null, 'Verwaltung: Notiz im Verlauf verborgen');
  perform testhilfe.zurueck();
  perform testhilfe.als(hr);
  select count(*) into n from public.austritt_meldung where dienstverhaeltnis_id = dv;
  perform testhilfe.pruefe(n = 1, 'Büro liest die Tabelle');

  -- 6. Unbestätigt: ändern nur beim Bestätigen, zurücknehmen geht
  perform testhilfe.erwarte_fehler(format('select public.austritt_korrigieren(%L, %L, %L)', m, 'falsch', heute + 6),
    'Diese Meldung ist noch nicht bestätigt.');

  -- 3. Bestätigen mit anderem Datum → neue Fassung; ein PDF der alten Fassung wird nicht mehr vermerkt
  perform testhilfe.zurueck();
  insert into public.dokument (organisation_id, dienstverhaeltnis_id, typ, kategorie, bezeichnung, status, datei_pfad, austritt_meldung_id)
    values (org, dv, 'austrittsmeldung', 'abmeldung', 'Austrittsmeldung', 'abgeschlossen', org || '/' || dv || '/abmeldung/alt.pdf', m)
    returning id into pdf_alt;
  perform testhilfe.als(hr);
  m := public.austritt_bestaetigen(m, heute + 7);
  perform testhilfe.zurueck();
  insert into public.dokument (organisation_id, dienstverhaeltnis_id, typ, kategorie, bezeichnung, status, datei_pfad, austritt_meldung_id)
    values (org, dv, 'austrittsmeldung', 'abmeldung', 'Austrittsmeldung', 'abgeschlossen', org || '/' || dv || '/abmeldung/neu.pdf', m)
    returning id into pdf_neu;
  perform testhilfe.als(hr);
  select coalesce(sum(vermerkt), 0) into n from public.uebermittlung_vermerken(array[pdf_alt]);
  perform testhilfe.pruefe(n = 0, 'PDF einer alten Fassung wird nicht vermerkt');
  perform testhilfe.pruefe((select art from public.uebermittlung_offen() where dienstverhaeltnis_id = dv) = 'abmeldung'
    and (select dokument_id from public.uebermittlung_offen() where dienstverhaeltnis_id = dv) = pdf_neu, 'neue Fassung bleibt Abmeldung');
  select coalesce(sum(vermerkt), 0) into n from public.uebermittlung_vermerken(array[pdf_neu, pdf_alt]);
  perform testhilfe.pruefe(n = 1, 'nur das aktuelle PDF gezählt');
  select coalesce(sum(vermerkt), 0) into n from public.uebermittlung_vermerken(array[pdf_neu]);
  perform testhilfe.pruefe(n = 0, 'zweites Vermerken zählt nichts');
  select count(*) into n from public.sammelversand where pdf_neu = any(dokument_ids);
  perform testhilfe.pruefe(n = 1, 'nur ein Sammelversand');

  -- 4. Abmeldebestätigung hochgeladen → abgemeldet; dann zurücknehmen (Korrektur übermittelt)
  perform testhilfe.zurueck();
  insert into public.dokument (organisation_id, dienstverhaeltnis_id, typ, kategorie, bezeichnung, status, datei_pfad, hochgeladen_am)
    values (org, dv, 'sonstiges', 'abmeldung', 'Abmeldebestätigung', 'abgeschlossen', org || '/' || dv || '/abmeldung/best.pdf', now());
  perform testhilfe.pruefe(app.dv_status(dv) = 'abgemeldet', 'abgemeldet');
  perform testhilfe.als(hr);
  m := public.austritt_korrigieren(m, 'bleibt doch', p_zuruecknehmen => true);
  perform testhilfe.pruefe((select art from public.uebermittlung_offen() where dienstverhaeltnis_id = dv) = 'korrektur', 'Rücknahme ist Korrektur');
  perform testhilfe.zurueck();
  insert into public.dokument (organisation_id, dienstverhaeltnis_id, typ, kategorie, bezeichnung, status, datei_pfad, austritt_meldung_id, uebermittelt_am)
    values (org, dv, 'korrekturmeldung', 'abmeldung', 'Korrektur', 'abgeschlossen', org || '/' || dv || '/abmeldung/k.pdf', m, now());

  -- 2. später ein neuer Austritt: das ist wieder eine Abmeldung, keine Korrektur
  -- in einer Transaktion ist now() gleich: Reihenfolge der Übermittlungen festlegen
  update public.dokument set uebermittelt_am = now() - interval '1 hour' where id = pdf_neu;
  update public.austritt_meldung set gemeldet_am = now() - interval '1 day' where dienstverhaeltnis_id = dv;
  update public.dokument set hochgeladen_am = now() - interval '1 day' where dienstverhaeltnis_id = dv and bezeichnung = 'Abmeldebestätigung';
  perform testhilfe.als(hr);
  m2 := public.austritt_melden(dv, 'austritt', heute + 20, 'einvernehmlich', null, true);
  perform testhilfe.pruefe((select art from public.uebermittlung_offen() where dienstverhaeltnis_id = dv) = 'abmeldung',
    'neuer Austritt nach übermittelter Rücknahme: Abmeldung, nicht Korrektur');
  perform testhilfe.pruefe((public.meldung_inhalt(m2)) ->> 'typ' = 'austrittsmeldung', 'PDF ist eine Austrittsmeldung');
  -- die alte Abmeldebestätigung gilt nicht für den neuen Austritt
  perform testhilfe.pruefe(app.dv_status(dv) = 'austritt_bestaetigt', 'alte Abmeldebestätigung zählt nicht: ' || app.dv_status(dv));
  perform testhilfe.zurueck();

  -- 5. Storno-Regel: Anmeldung schon übermittelt (Dienstzettel), aber keine Bestätigung → Storno ausständig
  dv2 := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1');
  update public.dienstverhaeltnis set eintritt = heute where id = dv2;
  insert into public.dokument (organisation_id, dienstverhaeltnis_id, typ, kategorie, bezeichnung, status, datei_pfad, uebermittelt_am)
    values (org, dv2, 'dienstzettel', 'vereinbarung', 'Dienstzettel', 'abgeschlossen', org || '/' || dv2 || '/vereinbarung/d.pdf', now());
  perform testhilfe.als(hr);
  perform public.austritt_melden(dv2, 'nicht_angetreten', p_notiz => 'nicht erschienen', p_gleich_bestaetigen => true);
  perform testhilfe.pruefe(app.dv_status(dv2) = 'storno_ausstaendig', 'Dienstzettel übermittelt: Storno ausständig');
  perform testhilfe.pruefe((select art from public.uebermittlung_offen() where dienstverhaeltnis_id = dv2) = 'storno', 'Storno auf der Liste');
  perform testhilfe.zurueck();
end $$;
rollback;
