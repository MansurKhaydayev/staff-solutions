-- Vertragsstand: einzige Quelle für Stunden, Löschschutz, Sichtbarkeit
begin;
do $$
declare
  hr uuid := testhilfe.benutzer('hr');
  sl_fremd uuid := testhilfe.benutzer('studioleitung', array['de000000-0000-0000-0000-0000000000e2']::uuid[]);
  verw uuid := testhilfe.benutzer('verwaltung');
  dv uuid;
  n int;
begin
  dv := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1');

  select count(*) into n from public.vertragsstand where dienstverhaeltnis_id = dv;
  perform testhilfe.pruefe(n = 1, 'genau ein Vertragsstand nach dem Dienstzettel');
  perform testhilfe.pruefe((select v.gueltig_ab = current_date and v.beschaeftigungsart = 'teilzeit'
      and v.wochenstunden = 20 and v.arbeitstage_woche = 5 from public.vertragsstand v where dienstverhaeltnis_id = dv),
    'erster Stand übernimmt die Werte des Dienstzettels');
  perform testhilfe.pruefe((select e.vertragsstand_id = v.id from public.entgelt e
      join public.vertragsstand v on v.dienstverhaeltnis_id = e.dienstverhaeltnis_id where e.dienstverhaeltnis_id = dv),
    'Entgelt verweist auf den ersten Stand');
  perform testhilfe.pruefe((app.stand_am(dv, current_date)).wochenstunden = 20, 'stand_am liefert 20 Stunden');

  -- Stunden nicht direkt änderbar, nichts löschbar
  perform testhilfe.als(hr);
  perform testhilfe.erwarte_fehler(format('update public.dienstverhaeltnis set wochenstunden = 30 where id = %L', dv),
    'Stunden ändern nur über eine Stundenanpassung');
  delete from public.vertragsstand where dienstverhaeltnis_id = dv;  -- keine Löschregel: trifft nichts
  perform testhilfe.pruefe((select count(*) from public.vertragsstand where dienstverhaeltnis_id = dv) = 1,
    'Vertragsstand lässt sich nicht löschen');
  perform testhilfe.erwarte_fehler(format('delete from public.entgelt where dienstverhaeltnis_id = %L', dv), 'nie gelöscht');
  insert into public.dokument (organisation_id, dienstverhaeltnis_id, typ)
    values ('de000000-0000-0000-0000-000000000001', dv, 'sonstiges');
  perform testhilfe.erwarte_fehler(format('delete from public.dokument where dienstverhaeltnis_id = %L', dv), 'nie gelöscht');
  perform testhilfe.zurueck();

  -- Verzeichnis liest den aktuellen Stand
  update public.vertragsstand set gueltig_ab = current_date - 1 where dienstverhaeltnis_id = dv;
  insert into public.vertragsstand (organisation_id, dienstverhaeltnis_id, gueltig_ab, beschaeftigungsart, wochenstunden, arbeitstage_woche)
    values ('de000000-0000-0000-0000-000000000001', dv, current_date, 'teilzeit', 25, 5);
  perform testhilfe.als(hr);
  perform testhilfe.pruefe((select wochenstunden from public.mitarbeiter_verzeichnis() where dienstverhaeltnis_id = dv) = 25,
    'Verzeichnis zeigt die Stunden des aktuellen Stands');

  -- Sichtbarkeit
  select count(*) into n from public.vertragsstand where dienstverhaeltnis_id = dv;
  perform testhilfe.pruefe(n = 2, 'Personalbüro sieht beide Stände');
  perform testhilfe.zurueck();
  perform testhilfe.als(sl_fremd);
  select count(*) into n from public.vertragsstand where dienstverhaeltnis_id = dv;
  perform testhilfe.pruefe(n = 0, 'Studioleitung eines anderen Studios sieht keinen Stand');
  perform testhilfe.zurueck();
  perform testhilfe.als(verw);
  select count(*) into n from public.vertragsstand where dienstverhaeltnis_id = dv;
  perform testhilfe.pruefe(n = 0, 'Verwaltung (ohne Personendaten) sieht keinen Stand');
  perform testhilfe.zurueck();
end $$;
select 'alle Tests bestanden' as ergebnis;
rollback;
