-- =====================================================================
-- Staff-Solutions - DEMO-Daten (alles erfunden, nur für die Vorführung)
-- Kann gefahrlos erneut ausgeführt werden: löscht zuerst die alte Demo-Firma.
-- =====================================================================
begin;

-- Alte Demo-Firma entfernen (falls vorhanden)
delete from public.vorlage        where organisation_id = 'de000000-0000-0000-0000-000000000001';
delete from public.brutto_tabelle where organisation_id = 'de000000-0000-0000-0000-000000000001';
delete from public.funktion       where organisation_id = 'de000000-0000-0000-0000-000000000001';
delete from public.standort       where organisation_id = 'de000000-0000-0000-0000-000000000001';
update public.gesellschaft set holding_id = null where organisation_id = 'de000000-0000-0000-0000-000000000001';
delete from public.gesellschaft   where organisation_id = 'de000000-0000-0000-0000-000000000001';
delete from public.lohnverrechner where organisation_id = 'de000000-0000-0000-0000-000000000001';
delete from public.marke          where organisation_id = 'de000000-0000-0000-0000-000000000001';
delete from public.tarifzone      where organisation_id = 'de000000-0000-0000-0000-000000000001';
delete from public.organisation   where id = 'de000000-0000-0000-0000-000000000001';

insert into public.organisation (id, name, probezeit_monate, befristung_monate)
values ('de000000-0000-0000-0000-000000000001', 'Demo Fitness Gruppe', 1, 3);

insert into public.tarifzone (id, organisation_id, name) values
  ('de000000-0000-0000-0000-0000000000a1', 'de000000-0000-0000-0000-000000000001', 'Standard'),
  ('de000000-0000-0000-0000-0000000000a2', 'de000000-0000-0000-0000-000000000001', 'Wien');

insert into public.marke (id, organisation_id, name) values
  ('de000000-0000-0000-0000-0000000000b1', 'de000000-0000-0000-0000-000000000001', 'DemoFit');

insert into public.lohnverrechner (id, organisation_id, name, email) values
  ('de000000-0000-0000-0000-0000000000c1', 'de000000-0000-0000-0000-000000000001', 'Demo Lohnbüro', 'lohn@demo.invalid');

insert into public.gesellschaft (id, organisation_id, name, strasse, plz, ort, marke_id, lohnverrechner_id, ist_holding) values
  ('de000000-0000-0000-0000-0000000000d1', 'de000000-0000-0000-0000-000000000001', 'DemoFit Holding GmbH',
   'Musterstraße 1', '8010', 'Graz', 'de000000-0000-0000-0000-0000000000b1', 'de000000-0000-0000-0000-0000000000c1', true);
insert into public.gesellschaft (id, organisation_id, name, strasse, plz, ort, marke_id, lohnverrechner_id, holding_id) values
  ('de000000-0000-0000-0000-0000000000d2', 'de000000-0000-0000-0000-000000000001', 'DemoFit Steiermark GmbH',
   'Musterstraße 1', '8010', 'Graz', 'de000000-0000-0000-0000-0000000000b1', 'de000000-0000-0000-0000-0000000000c1',
   'de000000-0000-0000-0000-0000000000d1'),
  ('de000000-0000-0000-0000-0000000000d3', 'de000000-0000-0000-0000-000000000001', 'DemoFit Wien GmbH',
   'Musterstraße 1', '8010', 'Graz', 'de000000-0000-0000-0000-0000000000b1', 'de000000-0000-0000-0000-0000000000c1',
   'de000000-0000-0000-0000-0000000000d1');

insert into public.standort (id, organisation_id, gesellschaft_id, tarifzone_id, name, art, vertragsbezeichnung) values
  ('de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-000000000001', 'de000000-0000-0000-0000-0000000000d2',
   'de000000-0000-0000-0000-0000000000a1', 'Leoben', 'studio', 'DemoFit Leoben'),
  ('de000000-0000-0000-0000-0000000000e2', 'de000000-0000-0000-0000-000000000001', 'de000000-0000-0000-0000-0000000000d2',
   'de000000-0000-0000-0000-0000000000a1', 'Bruck an der Mur', 'studio', 'DemoFit Bruck an der Mur'),
  ('de000000-0000-0000-0000-0000000000e3', 'de000000-0000-0000-0000-000000000001', 'de000000-0000-0000-0000-0000000000d3',
   'de000000-0000-0000-0000-0000000000a2', 'Wien Mitte', 'studio', 'DemoFit Wien Mitte'),
  ('de000000-0000-0000-0000-0000000000e4', 'de000000-0000-0000-0000-000000000001', 'de000000-0000-0000-0000-0000000000d1',
   'de000000-0000-0000-0000-0000000000a1', 'Büro Graz', 'buero', 'Graz');

insert into public.funktion (id, organisation_id, name) values
  ('de000000-0000-0000-0000-0000000000f1', 'de000000-0000-0000-0000-000000000001', 'Servicekraft'),
  ('de000000-0000-0000-0000-0000000000f2', 'de000000-0000-0000-0000-000000000001', 'Studioleitung'),
  ('de000000-0000-0000-0000-0000000000f3', 'de000000-0000-0000-0000-000000000001', 'Reinigungskraft'),
  ('de000000-0000-0000-0000-0000000000f4', 'de000000-0000-0000-0000-000000000001', 'Verwaltung');

-- Erfundene Netto-Brutto-Werte (KEINE echte Berechnung!), 500 bis 2.500 € in 50-€-Schritten
insert into public.brutto_tabelle (organisation_id, tarifzone_id, netto, brutto, gueltig_ab)
select 'de000000-0000-0000-0000-000000000001', z.id, n,
       round(n * case when z.name = 'Wien' then 1.31 else 1.30 end, 2), date '2026-01-01'
from generate_series(500, 2500, 50) as n
cross join public.tarifzone z
where z.organisation_id = 'de000000-0000-0000-0000-000000000001';

insert into public.vorlage (organisation_id, funktion_id, typ, name, platzhalter) values
  ('de000000-0000-0000-0000-000000000001', 'de000000-0000-0000-0000-0000000000f1', 'dienstvertrag',
   'Arbeiterdienstvertrag Servicekraft (Demo)',
   '["gmbh_name","gmbh_strasse","gmbh_plz_ort","name","strasse","plz_ort","dienstantritt","befristung_ende","arbeitsort","brutto","beschaeftigungsart","wochenstunden","ort_datum_arbeitnehmer","ort_datum_arbeitgeber"]'),
  ('de000000-0000-0000-0000-000000000001', 'de000000-0000-0000-0000-0000000000f2', 'dienstvertrag',
   'Arbeiterdienstvertrag Studioleitung (Demo)',
   '["gmbh_name","gmbh_strasse","gmbh_plz_ort","name","strasse","plz_ort","dienstantritt","befristung_ende","arbeitsort","brutto","beschaeftigungsart","wochenstunden","ort_datum_arbeitnehmer","ort_datum_arbeitgeber"]'),
  ('de000000-0000-0000-0000-000000000001', null, 'einzelvereinbarung', 'Einzelvereinbarung Leiterzulage (Demo)',
   '["gmbh_name","gmbh_strasse","gmbh_plz_ort","name","strasse","plz_ort","dienstantritt","funktion","gueltig_ab","betrag","ort_datum_arbeitnehmer","ort_datum_arbeitgeber"]'),
  ('de000000-0000-0000-0000-000000000001', null, 'einzelvereinbarung', 'Einzelvereinbarung Sonderzahlungen (Demo)',
   '["gmbh_name","gmbh_strasse","gmbh_plz_ort","name","strasse","plz_ort","dienstantritt","gueltig_ab","ort_datum_arbeitnehmer","ort_datum_arbeitgeber"]');

commit;

-- Kontrolle
select 'GmbHs' as was, count(*) from public.gesellschaft where organisation_id = 'de000000-0000-0000-0000-000000000001'
union all select 'Standorte', count(*) from public.standort where organisation_id = 'de000000-0000-0000-0000-000000000001'
union all select 'Brutto-Zeilen', count(*) from public.brutto_tabelle where organisation_id = 'de000000-0000-0000-0000-000000000001'
union all select 'Vorlagen', count(*) from public.vorlage where organisation_id = 'de000000-0000-0000-0000-000000000001';
