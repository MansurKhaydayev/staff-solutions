-- Stundenanpassung: neuer Stand + Entgelt + Vereinbarung ohne Datei; Prüfregeln; Storno
begin;
do $$
declare
  hr uuid := testhilfe.benutzer('hr');
  sl uuid := testhilfe.benutzer('studioleitung', array['de000000-0000-0000-0000-0000000000e1']::uuid[]);
  rl uuid := testhilfe.benutzer('regionalleitung', array['de000000-0000-0000-0000-0000000000e1']::uuid[]);
  dv uuid;
  st uuid; st2 uuid; erst uuid;
  tag text := to_char(current_date + 30, 'DD.MM.YYYY');
  aufruf text;
begin
  dv := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1');
  select id into erst from public.vertragsstand where dienstverhaeltnis_id = dv;
  aufruf := 'select public.stunden_anpassen(%L, %L::date, %L, %s, %s, %s)';

  perform testhilfe.als(hr);
  st := public.stunden_anpassen(dv, current_date + 30, 'vollzeit', 40, 5, 1500);
  perform testhilfe.pruefe((app.stand_am(dv, current_date)).wochenstunden = 20, 'heute gelten noch 20 Stunden');
  perform testhilfe.pruefe((app.stand_am(dv, current_date + 30)).wochenstunden = 40, 'ab dem Stichtag gelten 40 Stunden');
  perform testhilfe.pruefe((select brutto = 1950.00 and quelle = 'tabelle' and vertragsstand_id = st from public.entgelt
    where dienstverhaeltnis_id = dv and gueltig_ab = current_date + 30), 'Entgelt mit Brutto 1950,00 und Bezug zum Stand');
  perform testhilfe.pruefe((select count(*) = 1 from public.dokument where vertragsstand_id = st and datei_pfad is null
    and kategorie = 'vereinbarung' and bezeichnung = 'Vereinbarung Stundenanpassung'), 'Vereinbarung ohne Datei angelegt');

  -- Prüfschwerpunkt 1: gleicher Tag noch einmal
  perform testhilfe.erwarte_fehler(format(aufruf, dv, current_date + 30, 'vollzeit', 40, 5, 1500),
    'Für den ' || tag || ' gibt es schon einen Stand.');
  -- Prüfschwerpunkt 3: Datumsgrenzen
  perform testhilfe.erwarte_fehler(format(aufruf, dv, current_date - 1, 'teilzeit', 25, 5, 1000), 'vor dem Dienstantritt');
  perform testhilfe.erwarte_fehler(format(aufruf, dv, current_date + 10, 'teilzeit', 25, 5, 1000), 'Es gibt schon einen späteren Stand');
  perform testhilfe.erwarte_fehler(format(aufruf, dv, current_date + 366, 'teilzeit', 25, 5, 1000), 'mehr als 1 Jahr');
  perform testhilfe.erwarte_fehler(format(aufruf, dv, current_date + 60, 'teilzeit', 40, 1, 1000), 'Höchstens 10 Stunden pro Tag');
  perform testhilfe.zurueck();

  update public.dienstverhaeltnis set austritt = current_date + 45 where id = dv;
  perform testhilfe.als(hr);
  perform testhilfe.erwarte_fehler(format(aufruf, dv, current_date + 60, 'teilzeit', 25, 5, 1000), 'nach dem Austritt');
  perform testhilfe.zurueck();
  update public.dienstverhaeltnis set austritt = null where id = dv;

  -- Nur das Büro
  perform testhilfe.als(sl);
  perform testhilfe.erwarte_fehler(format(aufruf, dv, current_date + 60, 'teilzeit', 25, 5, 1000), 'trägt das Personalbüro ein');
  perform testhilfe.zurueck();
  perform testhilfe.als(rl);
  perform testhilfe.erwarte_fehler(format(aufruf, dv, current_date + 60, 'teilzeit', 25, 5, 1000), 'trägt das Personalbüro ein');
  perform testhilfe.zurueck();

  -- Storno
  perform testhilfe.als(hr);
  perform testhilfe.erwarte_fehler(format('select public.stand_stornieren(%L, %L)', st, ' '), 'Bitte einen Grund angeben.');
  perform testhilfe.erwarte_fehler(format('select public.stand_stornieren(%L, %L)', erst, 'Test'), 'aus dem Dienstzettel kann nicht storniert');
  perform public.stand_stornieren(st, 'Tippfehler beim Datum');
  perform testhilfe.pruefe((app.stand_am(dv, current_date + 30)).wochenstunden = 20, 'stornierter Stand zählt nicht mehr');
  perform testhilfe.pruefe((select storniert_am is not null from public.entgelt where vertragsstand_id = st), 'Entgelt ist mitstorniert');
  perform testhilfe.pruefe((select storno_grund = 'Tippfehler beim Datum' from public.vertragsstand where id = st), 'Grund bleibt sichtbar');
  perform testhilfe.erwarte_fehler(format('select public.stand_stornieren(%L, %L)', st, 'nochmal'), 'schon storniert');
  st2 := public.stunden_anpassen(dv, current_date + 30, 'vollzeit', 40, 5, 1500);
  perform testhilfe.pruefe(st2 is not null and st2 <> st, 'nach Storno ist derselbe Tag wieder möglich');
  perform testhilfe.zurueck();

  perform testhilfe.als(sl);
  perform testhilfe.erwarte_fehler(format('select public.stand_stornieren(%L, %L)', st2, 'x'), 'kann nur das Personalbüro');
  perform testhilfe.zurueck();
end $$;
select 'alle Tests bestanden' as ergebnis;
rollback;
