-- Übermittlung an die Lohnverrechner: Liste, Sammelversand, Korrektur, neue offene Punkte
begin;
do $$
declare
  org uuid := 'de000000-0000-0000-0000-000000000001';
  hr uuid := testhilfe.benutzer('hr');
  sl uuid := testhilfe.benutzer('studioleitung', array['de000000-0000-0000-0000-0000000000e1']::uuid[]);
  heute date := app.heute_wien();
  dv1 uuid; dv2 uuid; dz1 uuid; dz2 uuid; m uuid; pdf uuid; pdf2 uuid; n int; t text;
begin
  -- dv1 in Leoben (DemoFit Steiermark → Demo Lohnbüro), dv2 in Wien (DemoFit Wien → Demo Lohnbüro Wien)
  dv1 := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1');
  dv2 := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e3', 'de000000-0000-0000-0000-0000000000f1');
  update public.dienstverhaeltnis set eintritt = heute - 30 where id in (dv1, dv2);
  insert into public.dokument (organisation_id, dienstverhaeltnis_id, typ, kategorie, bezeichnung, status, datei_pfad)
    values (org, dv1, 'dienstzettel', 'vereinbarung', 'Dienstzettel', 'abgeschlossen', org || '/' || dv1 || '/vereinbarung/1.pdf')
    returning id into dz1;
  insert into public.dokument (organisation_id, dienstverhaeltnis_id, typ, kategorie, bezeichnung, status, datei_pfad)
    values (org, dv2, 'dienstzettel', 'vereinbarung', 'Dienstzettel', 'abgeschlossen', org || '/' || dv2 || '/vereinbarung/2.pdf')
    returning id into dz2;

  -- Liste: zwei Anmeldungen bei zwei Lohnverrechnern
  perform testhilfe.als(hr);
  select count(distinct lohnverrechner_id) into n from public.uebermittlung_offen() where dienstverhaeltnis_id in (dv1, dv2);
  perform testhilfe.pruefe(n = 2, 'zwei Lohnverrechner');
  perform testhilfe.pruefe((select art from public.uebermittlung_offen() where dokument_id = dz1) = 'anmeldung', 'Anmeldung auf der Liste');
  perform testhilfe.zurueck();

  -- Leitung: leere Liste, Vermerken verboten
  perform testhilfe.als(sl);
  select count(*) into n from public.uebermittlung_offen();
  perform testhilfe.pruefe(n = 0, 'Leitung sieht keine Liste');
  perform testhilfe.erwarte_fehler(format('select * from public.uebermittlung_vermerken(%L)', array[dz1]), 'Das darf nur das Personalbüro.');
  perform testhilfe.zurueck();

  -- Vermerken: ein Dokument ist inzwischen ersetzt → nur die offenen zählen
  update public.dokument set ersetzt_durch = dz1 where id = dz2;  -- dz2 gilt als ersetzt
  perform testhilfe.als(hr);
  select sum(vermerkt) into n from public.uebermittlung_vermerken(array[dz1, dz2]);
  perform testhilfe.pruefe(n = 1, 'nur offene Unterlagen vermerkt');
  select count(*) into n from public.uebermittlung_vermerken(array[dz1]);
  perform testhilfe.pruefe(n = 0, 'zweites Vermerken ändert nichts');
  perform testhilfe.pruefe(not exists (select 1 from public.uebermittlung_offen() where dokument_id = dz1), 'Anmeldung erledigt');
  perform testhilfe.zurueck();
  select count(*) into n from public.sammelversand where dz1 = any(dokument_ids);
  perform testhilfe.pruefe(n = 1, 'Sammelversand protokolliert');

  -- Austritt bestätigen → Abmeldung ohne PDF auf der Liste, offener Punkt mit Frist
  perform testhilfe.als(hr);
  m := public.austritt_melden(dv1, 'austritt', heute, 'probezeit', null, true);
  perform testhilfe.pruefe((select art from public.uebermittlung_offen() where dienstverhaeltnis_id = dv1) = 'abmeldung', 'Abmeldung');
  perform testhilfe.pruefe((select dokument_id from public.uebermittlung_offen() where dienstverhaeltnis_id = dv1) is null, 'PDF fehlt noch');
  select beschreibung into t from public.offene_punkte() where dienstverhaeltnis_id = dv1 and art = 'abmeldung';
  perform testhilfe.pruefe(t = 'Abmeldung übermitteln bis ' || to_char(heute + 7, 'DD.MM.YYYY'), 'offener Punkt Abmeldung: ' || coalesce(t, '-'));
  perform testhilfe.zurueck();
  update public.organisation set abmeldefrist_tage = 10 where id = org;
  perform testhilfe.als(hr);
  perform testhilfe.pruefe((select datum from public.offene_punkte() where dienstverhaeltnis_id = dv1 and art = 'abmeldung') = heute + 10,
    'Frist aus den Einstellungen');
  perform testhilfe.zurueck();

  -- PDF liegt vor (wie von der Edge Function abgelegt) → auf der Liste mit Dokument
  insert into public.dokument (organisation_id, dienstverhaeltnis_id, typ, kategorie, bezeichnung, status, datei_pfad, austritt_meldung_id)
    values (org, dv1, 'austrittsmeldung', 'abmeldung', 'Austrittsmeldung', 'abgeschlossen', org || '/' || dv1 || '/abmeldung/m.pdf', m)
    returning id into pdf;
  perform testhilfe.als(hr);
  perform testhilfe.pruefe((select dokument_id from public.uebermittlung_offen() where dienstverhaeltnis_id = dv1) = pdf, 'PDF auf der Liste');
  perform public.uebermittlung_vermerken(array[pdf]);
  perform testhilfe.pruefe(not exists (select 1 from public.uebermittlung_offen() where dienstverhaeltnis_id = dv1), 'Abmeldung übermittelt');
  perform testhilfe.pruefe((select beschreibung from public.offene_punkte() where dienstverhaeltnis_id = dv1 and art = 'abmeldung')
    like 'Abmeldebestätigung hochladen%', 'nach Übermittlung: Bestätigung hochladen');

  -- Prüfschwerpunkt 5: zurücknehmen nach Übermittlung → aktiv, Korrektur auf der Liste
  m := public.austritt_korrigieren(m, 'bleibt doch', p_zuruecknehmen => true);
  perform testhilfe.pruefe(app.dv_status(dv1) = 'aktiv', 'zurückgenommen: aktiv');
  perform testhilfe.pruefe((select art from public.uebermittlung_offen() where dienstverhaeltnis_id = dv1) = 'korrektur', 'Korrektur fällig');
  perform testhilfe.pruefe((select meldung_id from public.uebermittlung_offen() where dienstverhaeltnis_id = dv1) = m, 'Korrektur zur neuen Fassung');
  perform testhilfe.zurueck();

  -- Abschrift: Abmeldebestätigung hochgeladen (dv2 austreten lassen)
  update public.dokument set ersetzt_durch = null where id = dz2;
  perform testhilfe.als(hr);
  perform public.austritt_melden(dv2, 'austritt', heute, 'kuendigung_an', null, true);
  perform testhilfe.zurueck();
  insert into public.dokument (organisation_id, dienstverhaeltnis_id, typ, kategorie, bezeichnung, status, datei_pfad)
    values (org, dv2, 'sonstiges', 'abmeldung', 'Abmeldebestätigung', 'abgeschlossen', org || '/' || dv2 || '/abmeldung/b.pdf')
    returning id into pdf2;
  perform testhilfe.als(hr);
  perform testhilfe.pruefe(exists (select 1 from public.offene_punkte() where dienstverhaeltnis_id = dv2 and art = 'abschrift'), 'Abschrift offen');
  perform testhilfe.pruefe(not exists (select 1 from public.offene_punkte() where dienstverhaeltnis_id = dv2 and art = 'abmeldung'), 'abgemeldet: kein Abmeldepunkt');
  perform public.abmeldung_aushaendigen(pdf2, 'ausdruck');
  perform testhilfe.pruefe(not exists (select 1 from public.offene_punkte() where dienstverhaeltnis_id = dv2 and art = 'abschrift'), 'Abschrift erledigt');
  perform testhilfe.zurueck();

  -- Leitung meldet → Büro hat „Austritt bestätigen“; ehemalige ohne Onboarding-Punkte
  perform testhilfe.als(sl);
  perform testhilfe.pruefe(not exists (select 1 from public.offene_punkte() where art = 'austritt_bestaetigen'), 'Leitung: kein Bestätigen-Punkt');
  perform testhilfe.zurueck();
  update public.dienstverhaeltnis set austritt = heute - 1 where id = dv2;
  perform testhilfe.als(hr);
  perform testhilfe.pruefe(not exists (select 1 from public.offene_punkte() where dienstverhaeltnis_id = dv2 and art = 'onboarding'),
    'Ehemalige: keine Onboarding-Punkte');
  perform testhilfe.zurueck();
end $$;
select 'ok' as ergebnis;
rollback;
