-- Onboarding: Checkliste je Dienstverhältnis, Ablehnung, Klärung mit der Geschäftsführung
begin;
do $$
declare
  org uuid := 'de000000-0000-0000-0000-000000000001';
  hr uuid := testhilfe.benutzer('hr');
  sl uuid := testhilfe.benutzer('studioleitung', array['de000000-0000-0000-0000-0000000000e1']::uuid[]);
  buch uuid := testhilfe.benutzer('buchhaltung');
  dv uuid; dvb uuid;
  u1 uuid; u2 uuid; u3 uuid; u4 uuid; u5 uuid;
  kl uuid; d4 uuid;
  h text := repeat('ab', 32);
  n int;
  pfad text;
begin
  -- Eigene Testliste (vorhandene Unterlagen der Demo-Firma werden in dieser Transaktion ausgeblendet)
  update public.onboarding_unterlage set aktiv = false where organisation_id = org;
  insert into public.onboarding_unterlage (organisation_id, bezeichnung, reihenfolge, pflicht, gilt_fuer) values
    (org, 'Einverständnis Stundenaufzeichnung', 1, true, 'beide') returning id into u1;
  insert into public.onboarding_unterlage (organisation_id, bezeichnung, reihenfolge, pflicht, gilt_fuer) values
    (org, 'Bildaufnahme', 2, true, 'beide') returning id into u2;
  insert into public.onboarding_unterlage (organisation_id, bezeichnung, reihenfolge, pflicht, gilt_fuer) values
    (org, 'Arbeitsanweisung', 3, true, 'beide') returning id into u3;
  insert into public.onboarding_unterlage (organisation_id, bezeichnung, reihenfolge, pflicht, gilt_fuer) values
    (org, 'Aushändigung Arbeitskleidung', 4, true, 'studio') returning id into u4;
  insert into public.onboarding_unterlage (organisation_id, bezeichnung, reihenfolge, pflicht, gilt_fuer) values
    (org, 'Foto für Website', 5, false, 'beide') returning id into u5;

  dv := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1');
  dvb := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e4', 'de000000-0000-0000-0000-0000000000f4');
  insert into storage.objects (bucket_id, name, metadata)
  select 'personalakte', org || '/' || dv || '/onboarding/' || x || '.pdf', '{"size":1000,"mimetype":"application/pdf"}'::jsonb
  from unnest(array['a', 'b', 'c', 'd']) x;

  perform testhilfe.als(hr);
  select count(*) into n from public.onboarding_stand(dv) where status = 'fehlt';
  perform testhilfe.pruefe(n = 5, 'Studio-Mitarbeiter: alle 5 Unterlagen fehlen');
  select count(*) into n from public.onboarding_stand(dvb);
  perform testhilfe.pruefe(n = 4, 'Büro-Mitarbeiter: 4 Unterlagen (ohne Arbeitskleidung)');

  perform public.dokument_ablegen(org || '/' || dv || '/onboarding/a.pdf', h, 'onboarding', 'Bildaufnahme', dv,
    p_onboarding_unterlage_id => u2);
  perform testhilfe.pruefe((select status from public.onboarding_stand(dv) where unterlage_id = u2) = 'erledigt', 'Bildaufnahme erledigt');

  perform public.dokument_ablegen(org || '/' || dv || '/onboarding/b.pdf', h, 'onboarding', 'Foto für Website', dv,
    p_onboarding_unterlage_id => u5, p_onboarding_ergebnis => 'abgelehnt');
  perform testhilfe.pruefe((select status from public.onboarding_stand(dv) where unterlage_id = u5) = 'abgelehnt',
    'freiwillige Unterlage abgelehnt zählt als erledigt');
  perform testhilfe.pruefe(not exists (select 1 from public.onboarding_klaerung where onboarding_unterlage_id = u5),
    'keine Klärung bei freiwilliger Unterlage');
  perform testhilfe.zurueck();

  -- Pflichtunterlage abgelehnt, hochgeladen durch die Studioleitung
  perform testhilfe.als(sl);
  perform public.dokument_ablegen(org || '/' || dv || '/onboarding/c.pdf', h, 'onboarding', 'Arbeitsanweisung', dv,
    p_onboarding_unterlage_id => u3, p_onboarding_ergebnis => 'abgelehnt');
  perform testhilfe.pruefe((select status from public.onboarding_stand(dv) where unterlage_id = u3) = 'klaerung',
    'abgelehnte Pflichtunterlage braucht Klärung');
  select id into kl from public.onboarding_klaerung where dienstverhaeltnis_id = dv and geschlossen_am is null;
  perform testhilfe.pruefe(kl is not null, 'Studioleitung sieht die offene Klärung');
  perform testhilfe.erwarte_fehler(format('select public.klaerung_schliessen(%L, %L)', kl, 'ok'), 'schließt das Personalbüro');
  perform testhilfe.erwarte_fehler(format('select public.onboarding_vermerken(%L, %L, %L)', dv, u1, 'nein'), 'vermerkt das Personalbüro');
  perform testhilfe.zurueck();

  perform testhilfe.als(hr);
  perform testhilfe.erwarte_fehler(format('select public.klaerung_schliessen(%L, %L)', kl, ' '), 'Bitte einen Vermerk');
  perform public.klaerung_schliessen(kl, 'GF: Zusammenarbeit möglich');
  perform testhilfe.pruefe((select status from public.onboarding_stand(dv) where unterlage_id = u3) = 'geklaert', 'Klärung geschlossen');

  -- Ablehnung ohne Datei, nur Vermerk durch das Büro
  perform public.onboarding_vermerken(dv, u1, 'Mündlich abgelehnt');
  perform testhilfe.pruefe((select status from public.onboarding_stand(dv) where unterlage_id = u1) = 'klaerung',
    'Vermerk bei Pflichtunterlage öffnet Klärung');

  -- Prüfschwerpunkt 5: Unterlage später deaktivieren oder nur fürs Büro
  d4 := public.dokument_ablegen(org || '/' || dv || '/onboarding/d.pdf', h, 'onboarding', 'Aushändigung Arbeitskleidung', dv,
    p_onboarding_unterlage_id => u4);
  update public.onboarding_unterlage set gilt_fuer = 'buero' where id = u4;
  update public.onboarding_unterlage set aktiv = false where id = u2;
  select count(*) into n from public.onboarding_stand(dv);
  perform testhilfe.pruefe(n = 3, 'deaktivierte und nicht passende Unterlagen zählen nicht mehr');
  perform testhilfe.pruefe(exists (select 1 from public.dokument where id = d4), 'Dokument bleibt trotzdem sichtbar');

  -- Nichts löschen
  delete from public.onboarding_unterlage where id = u5;
  perform testhilfe.pruefe(exists (select 1 from public.onboarding_unterlage where id = u5), 'Unterlage lässt sich nicht löschen');
  perform testhilfe.zurueck();

  -- Ohne Dokumente-Recht keine Checkliste
  perform testhilfe.als(buch);
  perform testhilfe.erwarte_fehler(format('select * from public.onboarding_stand(%L)', dv), 'Keine Berechtigung');
  perform testhilfe.zurueck();

  -- Leitung darf die Liste nicht ändern
  perform testhilfe.als(sl);
  update public.onboarding_unterlage set pflicht = false where id = u1;
  perform testhilfe.zurueck();
  perform testhilfe.pruefe((select pflicht from public.onboarding_unterlage where id = u1), 'Studioleitung ändert die Liste nicht');
end $$;
select 'alle Tests bestanden' as ergebnis;
rollback;
