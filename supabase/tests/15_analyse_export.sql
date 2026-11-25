-- Recht „Analyse herunterladen“: Admin und GF vergeben, sonst niemand, jeder Download und jede Änderung protokolliert
begin;
do $$
declare
  org uuid := 'de000000-0000-0000-0000-000000000001';
  adm uuid := testhilfe.benutzer('admin');
  gf uuid := testhilfe.benutzer('geschaeftsfuehrung');
  hr uuid := testhilfe.benutzer('hr');
  sl uuid := testhilfe.benutzer('studioleitung', array['de000000-0000-0000-0000-0000000000e1']::uuid[]);
  v_id bigint;
begin
  -- Voreinstellung: Admin und GF dürfen herunterladen, nur die GF vergibt
  perform testhilfe.pruefe((select darf_analyse_export from public.rollen_recht where organisation_id = org and rolle = 'admin'), 'Admin darf herunterladen');
  perform testhilfe.pruefe((select darf_analyse_export from public.rollen_recht where organisation_id = org and rolle = 'geschaeftsfuehrung'), 'GF darf herunterladen');
  perform testhilfe.pruefe(not (select darf_analyse_export from public.rollen_recht where organisation_id = org and rolle = 'hr'), 'Personalbüro darf nicht');
  perform testhilfe.pruefe((select array_agg(rolle order by rolle) from public.rollen_recht where organisation_id = org and vergibt_analyse_export)
    = array['admin', 'geschaeftsfuehrung'], 'nur Admin und GF vergeben');

  -- Download mit Recht: Protokolleintrag
  perform testhilfe.als(adm);
  v_id := public.analyse_export_vermerken(2026, 11, null);
  perform testhilfe.pruefe(v_id is not null, 'Admin bekommt eine Protokollnummer');
  perform testhilfe.zurueck();
  perform testhilfe.pruefe(exists (select 1 from public.audit_log where id = v_id and tabelle = 'analyse' and aktion = 'export'
    and user_id = adm and neu ->> 'monat' = '11'), 'Download ist protokolliert');

  -- Ohne Recht: abgelehnt, kein Eintrag
  perform testhilfe.als(hr);
  perform testhilfe.erwarte_fehler('select public.analyse_export_vermerken(2026, 11, null)', 'nicht herunterladen');
  perform testhilfe.zurueck();
  perform testhilfe.pruefe(not exists (select 1 from public.audit_log where tabelle = 'analyse' and user_id = hr), 'kein Eintrag ohne Recht');
  perform testhilfe.als(sl);
  perform testhilfe.erwarte_fehler('select public.analyse_export_vermerken(2026, 11, null)', 'nicht herunterladen');
  perform testhilfe.zurueck();

  -- Ungültige Eingaben
  perform testhilfe.als(gf);
  perform testhilfe.erwarte_fehler('select public.analyse_export_vermerken(2026, 13, null)', 'gültigen Monat');
  perform testhilfe.erwarte_fehler(format('select public.analyse_export_vermerken(2026, 1, %L)', gen_random_uuid()), 'Arbeitsort');
  perform testhilfe.zurueck();

  -- Personalbüro darf nicht vergeben; direkt ändern geht für niemanden (auch nicht für den Admin)
  perform testhilfe.als(hr);
  perform testhilfe.erwarte_fehler($q$select public.analyse_recht_setzen('hr', true)$q$, 'nur Rollen ändern');
  perform testhilfe.zurueck();
  perform testhilfe.als(adm);
  perform testhilfe.erwarte_fehler($q$update public.rollen_recht set darf_analyse_export = true where rolle = 'hr'$q$, 'nur Rollen ändern');
  perform testhilfe.erwarte_fehler($q$update public.rollen_recht set vergibt_analyse_export = true where rolle = 'hr'$q$, 'nur Rollen ändern');
  -- Admin vergibt über die Funktion: Personalbüro darf dann herunterladen
  perform public.analyse_recht_setzen('hr', true);
  perform testhilfe.zurueck();
  perform testhilfe.pruefe((select darf_analyse_export from public.rollen_recht where organisation_id = org and rolle = 'hr'), 'Admin hat dem Personalbüro das Recht gegeben');
  perform testhilfe.als(hr);
  perform testhilfe.pruefe(public.analyse_export_vermerken(2026, 11, null) is not null, 'Personalbüro kann jetzt herunterladen');
  perform testhilfe.zurueck();

  -- GF entzieht dem Admin das Recht: Admin kann nicht mehr herunterladen, Änderung protokolliert
  perform testhilfe.als(gf);
  perform public.analyse_recht_setzen('admin', false);
  perform testhilfe.erwarte_fehler($q$select public.analyse_recht_setzen('gibtsnicht', true)$q$, 'Rolle gibt es nicht');
  perform testhilfe.zurueck();
  perform testhilfe.pruefe(not (select darf_analyse_export from public.rollen_recht where organisation_id = org and rolle = 'admin'), 'Admin-Recht entzogen');
  perform testhilfe.pruefe(exists (select 1 from public.audit_log where tabelle = 'rollen_recht' and aktion = 'analyse_recht'
    and user_id = gf and neu ->> 'rolle' = 'admin' and neu ->> 'darf_analyse_export' = 'false'), 'Entzug ist protokolliert');
  perform testhilfe.als(adm);
  perform testhilfe.erwarte_fehler('select public.analyse_export_vermerken(2026, 11, null)', 'nicht herunterladen');
  perform testhilfe.zurueck();

  -- Andere Einstellungen kann der Admin weiter ändern (die Sperre betrifft nur die beiden Spalten)
  perform testhilfe.als(adm);
  update public.rollen_recht set sieht_kontakt = sieht_kontakt where rolle = 'hr';
  perform testhilfe.zurueck();

  raise notice 'alle Tests bestanden';
end $$;
rollback;
