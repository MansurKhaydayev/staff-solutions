-- Austritt und nicht angetreten: Grundlage (Status) und Ablauf (melden, bestätigen, korrigieren)
begin;

-- Teil 1: Grundlage
do $$
declare
  org uuid := 'de000000-0000-0000-0000-000000000001';
  hr uuid := testhilfe.benutzer('hr');
  dv uuid; m uuid; n int;
begin
  dv := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1');
  update public.dienstverhaeltnis set eintritt = app.heute_wien() - 30 where id = dv;

  perform testhilfe.pruefe(app.dv_status(dv) = 'aktiv', 'ohne Meldung aktiv');
  perform testhilfe.pruefe(app.dv_aktiv(dv), 'ohne Meldung in aktiven Listen');

  -- Austrittsarten für die Demo-Firma angelegt
  select count(*) into n from public.austrittsart where organisation_id = org;
  perform testhilfe.pruefe(n = 8, 'acht Austrittsarten');

  -- gemeldet, nicht bestätigt
  insert into public.austritt_meldung (organisation_id, dienstverhaeltnis_id, art, letzter_arbeitstag, austrittsart, gemeldet_von)
    values (org, dv, 'austritt', app.heute_wien(), 'probezeit', hr) returning id into m;
  perform testhilfe.pruefe(app.dv_status(dv) = 'austritt_gemeldet', 'gemeldet');
  perform testhilfe.pruefe(app.dv_aktiv(dv), 'gemeldet bleibt aktiv');

  -- zweite gültige Meldung nicht möglich
  perform testhilfe.erwarte_fehler(format(
    'insert into public.austritt_meldung (organisation_id, dienstverhaeltnis_id, art, notiz) values (%L, %L, %L, %L)',
    org, dv, 'nicht_angetreten', 'x'), 'austritt_meldung_eine_gueltige');

  -- bestätigt
  update public.austritt_meldung set bestaetigt_am = now(), bestaetigt_von = hr where id = m;
  update public.dienstverhaeltnis set austritt = app.heute_wien() where id = dv;
  perform testhilfe.pruefe(app.dv_status(dv) = 'austritt_bestaetigt', 'bestätigt');
  perform testhilfe.pruefe(app.dv_aktiv(dv), 'letzter Arbeitstag heute: noch aktiv');
  update public.dienstverhaeltnis set austritt = app.heute_wien() - 1 where id = dv;
  perform testhilfe.pruefe(not app.dv_aktiv(dv), 'nach dem letzten Arbeitstag nicht mehr aktiv');

  -- erzeugtes Meldungs-PDF allein ist keine Abmeldebestätigung
  insert into public.dokument (organisation_id, dienstverhaeltnis_id, typ, kategorie, bezeichnung, status, datei_pfad, austritt_meldung_id)
    values (org, dv, 'austrittsmeldung', 'abmeldung', 'Austrittsmeldung', 'abgeschlossen', org || '/' || dv || '/abmeldung/m.pdf', m);
  perform testhilfe.pruefe(app.dv_status(dv) = 'austritt_bestaetigt', 'Meldungs-PDF zählt nicht als Bestätigung');
  insert into public.dokument (organisation_id, dienstverhaeltnis_id, typ, kategorie, bezeichnung, status, datei_pfad)
    values (org, dv, 'sonstiges', 'abmeldung', 'Abmeldebestätigung', 'abgeschlossen', org || '/' || dv || '/abmeldung/b.pdf');
  perform testhilfe.pruefe(app.dv_status(dv) = 'abgemeldet', 'abgemeldet');

  -- zurückgenommen = wieder aktiv
  update public.austritt_meldung set zurueckgenommen = true where id = m;
  perform testhilfe.pruefe(app.dv_status(dv) = 'aktiv', 'zurückgenommen');

  -- direktes Schreiben aus der App gesperrt
  perform testhilfe.als(hr);
  perform testhilfe.erwarte_fehler(format(
    'insert into public.austritt_meldung (organisation_id, dienstverhaeltnis_id, art, notiz) values (%L, %L, %L, %L)',
    org, dv, 'nicht_angetreten', 'x'), '');
  update public.austritt_meldung set notiz = 'y' where id = m;  -- ohne Recht: ändert nichts
  perform testhilfe.zurueck();
  perform testhilfe.pruefe((select notiz from public.austritt_meldung where id = m) is null, 'direktes Ändern wirkt nicht');
end $$;

do $$
declare
  org uuid := 'de000000-0000-0000-0000-000000000001';
  hr uuid := testhilfe.benutzer('hr');
  dv uuid; m uuid;
begin
  -- nicht angetreten, nie angemeldet
  dv := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1');
  insert into public.austritt_meldung (organisation_id, dienstverhaeltnis_id, art, notiz, gemeldet_von)
    values (org, dv, 'nicht_angetreten', 'nicht erschienen', hr) returning id into m;
  perform testhilfe.pruefe(app.dv_status(dv) = 'nicht_angetreten_gemeldet', 'nicht angetreten gemeldet');
  update public.austritt_meldung set bestaetigt_am = now(), bestaetigt_von = hr where id = m;
  perform testhilfe.pruefe(app.dv_status(dv) = 'nicht_angetreten', 'nicht angetreten, nie angemeldet');
  perform testhilfe.pruefe(not app.dv_aktiv(dv), 'nicht angetreten nicht aktiv');

  -- angemeldet → Storno ausständig, mit Storno-Bestätigung → nicht angetreten
  insert into public.dokument (organisation_id, dienstverhaeltnis_id, typ, kategorie, bezeichnung, status, datei_pfad)
    values (org, dv, 'anmeldebestaetigung', 'anmeldung', 'Anmeldung', 'abgeschlossen', org || '/' || dv || '/anmeldung/a.pdf');
  perform testhilfe.pruefe(app.dv_status(dv) = 'storno_ausstaendig', 'Storno ausständig');
  insert into public.dokument (organisation_id, dienstverhaeltnis_id, typ, kategorie, bezeichnung, status, datei_pfad)
    values (org, dv, 'sonstiges', 'storno', 'Storno', 'abgeschlossen', org || '/' || dv || '/storno/s.pdf');
  perform testhilfe.pruefe(app.dv_status(dv) = 'nicht_angetreten', 'Storno liegt vor');

  -- Austrittsdatum lässt sich aus der App nicht direkt setzen
  perform testhilfe.als(hr);
  perform testhilfe.erwarte_fehler(format('update public.dienstverhaeltnis set austritt = %L where id = %L', app.heute_wien(), dv),
    'Der Austritt ändert sich nur über');
  perform testhilfe.zurueck();
end $$;

-- Teil 2: Ablauf
do $$
declare
  org uuid := 'de000000-0000-0000-0000-000000000001';
  e1 uuid := 'de000000-0000-0000-0000-0000000000e1';
  hr uuid := testhilfe.benutzer('hr');
  sl uuid := testhilfe.benutzer('studioleitung', array['de000000-0000-0000-0000-0000000000e1']::uuid[]);
  sl3 uuid := testhilfe.benutzer('studioleitung', array['de000000-0000-0000-0000-0000000000e3']::uuid[]);
  rl uuid := testhilfe.benutzer('regionalleitung', array['de000000-0000-0000-0000-0000000000e1']::uuid[]);
  vw uuid := testhilfe.benutzer('verwaltung');
  dv uuid; dv2 uuid; dv3 uuid; m uuid; m2 uuid; n int; j jsonb; heute date := app.heute_wien();
begin
  dv := testhilfe.mitarbeiter_anlegen(hr, e1, 'de000000-0000-0000-0000-0000000000f1');
  update public.dienstverhaeltnis set eintritt = heute - 30 where id = dv;

  -- Leitung im fremden Studio, Verwaltung ohne Anlegen-Recht
  perform testhilfe.als(sl3);
  perform testhilfe.erwarte_fehler(format('select public.austritt_melden(%L, %L, %L, %L)', dv, 'austritt', heute, 'probezeit'),
    'Du bist für dieses Studio nicht zuständig.');
  perform testhilfe.zurueck();
  perform testhilfe.als(vw);
  perform testhilfe.erwarte_fehler(format('select public.austritt_melden(%L, %L, %L, %L)', dv, 'austritt', heute, 'probezeit'),
    'keinen Austritt melden');
  perform testhilfe.zurueck();

  -- Prüfregeln
  perform testhilfe.als(sl);
  perform testhilfe.erwarte_fehler(format('select public.austritt_melden(%L, %L, null, %L)', dv, 'austritt', 'probezeit'),
    'Bitte den letzten Arbeitstag angeben.');
  perform testhilfe.erwarte_fehler(format('select public.austritt_melden(%L, %L, %L, %L)', dv, 'austritt', heute - 31, 'probezeit'),
    'Der letzte Arbeitstag darf nicht vor dem Dienstantritt liegen.');
  perform testhilfe.erwarte_fehler(format('select public.austritt_melden(%L, %L, %L, %L)', dv, 'austritt', heute + 400, 'probezeit'),
    'Der letzte Arbeitstag darf höchstens ein Jahr in der Zukunft liegen.');
  perform testhilfe.erwarte_fehler(format('select public.austritt_melden(%L, %L, %L, %L)', dv, 'austritt', heute, 'gibtsnicht'),
    'Bitte die Art des Austritts wählen.');
  perform testhilfe.erwarte_fehler(format('select public.austritt_melden(%L, %L, p_notiz => %L)', dv, 'nicht_angetreten', ' '),
    'Bitte einen Grund angeben.');
  perform testhilfe.erwarte_fehler(format('select public.austritt_melden(%L, %L, %L, %L, p_gleich_bestaetigen => true)',
    dv, 'austritt', heute, 'probezeit'), 'Das darf nur das Personalbüro.');

  -- Leitung meldet
  m := public.austritt_melden(dv, 'austritt', heute + 3, 'probezeit', 'Lösung durch AG');
  perform testhilfe.erwarte_fehler(format('select public.austritt_melden(%L, %L, %L, %L)', dv, 'austritt', heute, 'probezeit'),
    'Für diese Person ist bereits ein Austritt oder');
  perform testhilfe.erwarte_fehler(format('select public.austritt_bestaetigen(%L)', m), 'Das darf nur das Personalbüro.');
  perform testhilfe.zurueck();
  perform testhilfe.pruefe(app.dv_status(dv) = 'austritt_gemeldet', 'Leitung hat gemeldet');
  perform testhilfe.pruefe((select austritt from public.dienstverhaeltnis where id = dv) is null, 'gemeldet: austritt noch leer');

  -- Büro bestätigt mit anderem Datum
  perform testhilfe.als(hr);
  m2 := public.austritt_bestaetigen(m, heute + 5);
  perform testhilfe.erwarte_fehler(format('select public.austritt_bestaetigen(%L)', m), 'Diese Meldung wurde inzwischen geändert.');
  perform testhilfe.erwarte_fehler(format('select public.austritt_bestaetigen(%L)', m2), 'Diese Meldung wurde inzwischen geändert.');
  select count(*) into n from public.austritt_verlauf(dv);
  perform testhilfe.pruefe(n = 2, 'Verlauf: zwei Fassungen');
  perform testhilfe.pruefe((select abweichung from public.austritt_verlauf(dv) where id = m2)
    = 'Letzter Arbeitstag ' || to_char(heute + 5, 'DD.MM.YYYY') || ' statt ' || to_char(heute + 3, 'DD.MM.YYYY'), 'Abweichung vermerkt');
  j := public.akte_kopf(dv);
  perform testhilfe.pruefe(j ->> 'status' = 'austritt_bestaetigt', 'Akte: Status');
  perform testhilfe.pruefe((j ->> 'abmeldung_bis')::date = heute + 12, 'Akte: Abmeldefrist');
  perform testhilfe.pruefe((select status from public.mitarbeiter_status() where dienstverhaeltnis_id = dv) = 'austritt_bestaetigt',
    'mitarbeiter_status: Status');
  perform testhilfe.zurueck();
  perform testhilfe.pruefe((select austritt from public.dienstverhaeltnis where id = dv) = heute + 5, 'bestätigt: austritt gesetzt');

  -- Sichtbarkeit von Art und Notiz
  perform testhilfe.als(vw);
  perform testhilfe.pruefe((select notiz from public.austritt_verlauf(dv) where id = m2) is null, 'Verwaltung sieht Notiz nicht');
  perform testhilfe.pruefe((select letzter_arbeitstag from public.austritt_verlauf(dv) where id = m2) = heute + 5, 'Verwaltung sieht Datum');
  perform testhilfe.zurueck();
  perform testhilfe.als(rl);
  perform testhilfe.pruefe((select notiz from public.austritt_verlauf(dv) where id = m2) = 'Lösung durch AG', 'Regionalleitung sieht Notiz');
  perform testhilfe.zurueck();
  perform testhilfe.als(sl);
  perform testhilfe.pruefe((select notiz from public.austritt_verlauf(dv) where id = m2) is null, 'Studioleitung sieht Notiz nicht');
  perform testhilfe.zurueck();

  -- Korrektur: zurücknehmen
  perform testhilfe.als(hr);
  perform testhilfe.erwarte_fehler(format('select public.austritt_korrigieren(%L, %L)', m2, ''), 'Bitte einen Grund angeben.');
  m := public.austritt_korrigieren(m2, 'bleibt doch', p_zuruecknehmen => true);
  perform testhilfe.zurueck();
  perform testhilfe.pruefe(app.dv_status(dv) = 'aktiv', 'zurückgenommen: aktiv');
  perform testhilfe.pruefe((select austritt from public.dienstverhaeltnis where id = dv) is null, 'zurückgenommen: austritt leer');
  -- danach neu melden geht (Büro meldet und bestätigt gleich)
  perform testhilfe.als(hr);
  m := public.austritt_melden(dv, 'austritt', heute, 'kuendigung_an', null, true);
  perform testhilfe.zurueck();
  perform testhilfe.pruefe(app.dv_status(dv) = 'austritt_bestaetigt', 'Büro meldet und bestätigt');
  select count(*) into n from public.austritt_meldung where dienstverhaeltnis_id = dv and ersetzt_durch is null;
  perform testhilfe.pruefe(n = 1, 'genau eine gültige Fassung');

  -- Mappe nach dem letzten Arbeitstag geschlossen
  update public.dienstverhaeltnis set austritt = heute - 1 where id = dv;
  perform testhilfe.als(hr);
  perform testhilfe.erwarte_fehler(format('select public.mappe_inhalt(%L)', dv), 'Die Mappe ist geschlossen.');
  perform testhilfe.zurueck();

  -- nicht angetreten: frühestens ab Dienstantritt, austritt bleibt leer
  dv2 := testhilfe.mitarbeiter_anlegen(hr, e1, 'de000000-0000-0000-0000-0000000000f1');
  update public.dienstverhaeltnis set eintritt = heute + 2 where id = dv2;
  perform testhilfe.als(sl);
  perform testhilfe.erwarte_fehler(format('select public.austritt_melden(%L, %L, p_notiz => %L)', dv2, 'nicht_angetreten', 'weg'),
    'kann erst ab dem geplanten Dienstantritt gemeldet werden.');
  perform testhilfe.zurueck();
  update public.dienstverhaeltnis set eintritt = heute where id = dv2;
  perform testhilfe.als(sl);
  m := public.austritt_melden(dv2, 'nicht_angetreten', p_notiz => 'nicht erschienen');
  perform testhilfe.zurueck();
  perform testhilfe.als(hr);
  perform public.austritt_bestaetigen(m);
  perform testhilfe.erwarte_fehler(format('select public.austritt_korrigieren(%L, %L)', m, 'x'), 'nur Zurücknehmen möglich');
  perform testhilfe.zurueck();
  perform testhilfe.pruefe(app.dv_status(dv2) = 'nicht_angetreten', 'nicht angetreten bestätigt');
  perform testhilfe.pruefe((select austritt from public.dienstverhaeltnis where id = dv2) is null, 'nicht angetreten: austritt leer');

  -- Zeitzone: um 23:30 Wiener Zeit zählt das Wiener Datum
  perform testhilfe.pruefe(app.heute_wien() = (now() at time zone 'Europe/Vienna')::date, 'Wiener Datum');
end $$;

select 'ok' as ergebnis;

rollback;
