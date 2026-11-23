-- Gemeinsame Prüfregeln für Dienstzettel und Stundenanpassung
begin;
do $$
declare
  org public.organisation;
  hr uuid := testhilfe.benutzer('hr');
  dv uuid;
begin
  select * into org from public.organisation where id = 'de000000-0000-0000-0000-000000000001';

  perform testhilfe.erwarte_fehler(format('select app.arbeitszeit_pruefen(%L::public.organisation, %L, 40, 1, 1000)', org, 'teilzeit'),
    'Höchstens 10 Stunden pro Tag');
  perform testhilfe.erwarte_fehler(format('select app.arbeitszeit_pruefen(%L::public.organisation, %L, 30, 5, 1000)', org, 'vollzeit'),
    'Vollzeit sind bei euch 40 Stunden');
  -- Grenze aus den Einstellungen der Firma (kann in den Einstellungen geändert werden)
  perform testhilfe.erwarte_fehler(format('select app.arbeitszeit_pruefen(%L::public.organisation, %L, 8, 2, %s)', org, 'geringfuegig',
    org.geringfuegig_grenze + 1), 'Geringfügig ist nur bis € ' || app.betrag(org.geringfuegig_grenze));
  perform app.arbeitszeit_pruefen(org, 'teilzeit', 20, 5, 1000);  -- gültig: kein Fehler

  perform testhilfe.pruefe(app.brutto_fuer(org.id, 'de000000-0000-0000-0000-0000000000a1', 1000, current_date) = 1300.00,
    'Brutto für 1000 € (Standard) sollte 1300,00 sein');
  perform testhilfe.pruefe(app.brutto_fuer(org.id, 'de000000-0000-0000-0000-0000000000a1', 1013, current_date) is null,
    'Brutto für 1013 € sollte offen (null) sein');

  -- Dienstzettel funktioniert weiterhin und meldet dieselben Fehler
  dv := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1');
  perform testhilfe.pruefe(dv is not null, 'Dienstzettel sollte ein Dienstverhältnis anlegen');
  perform testhilfe.pruefe((select brutto from public.entgelt where dienstverhaeltnis_id = dv) = 1300.00,
    'Dienstzettel sollte Brutto 1300,00 eintragen');
end $$;
select 'alle Tests bestanden' as ergebnis;
rollback;
