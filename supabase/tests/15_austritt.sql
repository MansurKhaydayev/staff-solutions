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
  update public.dienstverhaeltnis set austritt = app.heute_wien() where id = dv;  -- ohne Recht: ändert nichts
  perform testhilfe.zurueck();
  perform testhilfe.pruefe((select austritt from public.dienstverhaeltnis where id = dv) is null, 'Austritt nicht direkt setzbar');
end $$;

-- TEIL2

select 'ok' as ergebnis;

rollback;
