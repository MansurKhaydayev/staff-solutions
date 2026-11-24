-- Fristregel für den Dienstantritt, Einstellungen, Textbausteine, Recht Arbeitgeber-Unterschrift
begin;
do $$
declare
  org uuid := 'de000000-0000-0000-0000-000000000001';
  sl uuid := testhilfe.benutzer('studioleitung', array['de000000-0000-0000-0000-0000000000e1']::uuid[]);
  hr uuid := testhilfe.benutzer('hr');
  n int;
begin
  update public.organisation set anmeldung_stichzeit = '12:00', tage_dazwischen_vor = 0, tage_dazwischen_nach = 1 where id = org;
  perform testhilfe.pruefe(app.fruehester_dienstantritt(org, '2026-11-27 18:00') = '2026-11-29', 'Freitag 18:00 → Sonntag');
  perform testhilfe.pruefe(app.fruehester_dienstantritt(org, '2026-11-25 11:59') = '2026-11-26', '11:59 → nächster Tag');
  perform testhilfe.pruefe(app.fruehester_dienstantritt(org, '2026-11-25 12:00') = '2026-11-26', '12:00 → nächster Tag');
  perform testhilfe.pruefe(app.fruehester_dienstantritt(org, '2026-11-25 12:01') = '2026-11-27', '12:01 → übernächster Tag');
  perform testhilfe.pruefe(app.fruehester_dienstantritt(org, ('2026-11-30 22:30+00'::timestamptz at time zone 'Europe/Vienna')) = '2026-12-02',
    '23:30 Wiener Zeit zählt zum Wiener Datum');
  perform testhilfe.pruefe(app.frist_meldung('2026-11-29') =
    'Zu kurzfristig. Frühester Dienstantritt ist Sonntag, 29.11.2026. Bei dringendem Bedarf „Dringende Anmeldung“ wählen.', 'Meldung');
  perform testhilfe.pruefe(app.heute_wien() = (now() at time zone 'Europe/Vienna')::date, 'heute in Wien');

  update public.organisation set anmeldung_stichzeit = '10:00', tage_dazwischen_nach = 2 where id = org;
  perform testhilfe.pruefe(app.fruehester_dienstantritt(org, '2026-11-25 11:00') = '2026-11-28', 'geänderte Einstellungen wirken');

  -- Textbausteine: Büro liest, Studioleitung nicht
  perform testhilfe.als(hr);
  select count(*) into n from public.textbaustein where organisation_id = org;
  perform testhilfe.pruefe(n >= 5, 'Personalbüro sieht die Textbausteine');
  perform testhilfe.zurueck();
  perform testhilfe.als(sl);
  select count(*) into n from public.textbaustein;
  perform testhilfe.pruefe(n = 0, 'Studioleitung sieht keine Textbausteine');
  perform testhilfe.zurueck();

  -- Onboarding-Texte und Recht Arbeitgeber-Unterschrift
  perform testhilfe.pruefe((select length(text) > 20 from public.onboarding_unterlage where id = 'de000000-0000-0000-0000-0000000000b2'),
    'Bildaufnahme hat einen Demo-Text');
  perform testhilfe.pruefe((select bool_and(darf_arbeitgeber_unterschreiben = (rolle in ('admin', 'geschaeftsfuehrung')))
    from public.rollen_recht where organisation_id = org), 'Arbeitgeber-Unterschrift: Admin und Geschäftsführung');
end $$;
select 'alle Tests bestanden' as ergebnis;
rollback;
