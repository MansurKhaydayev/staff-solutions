-- Akte-Kopf je Rolle, Protokoll, offene Punkte
begin;
do $$
declare
  hr uuid := testhilfe.benutzer('hr');
  verw uuid := testhilfe.benutzer('verwaltung');
  sl uuid := testhilfe.benutzer('studioleitung', array['de000000-0000-0000-0000-0000000000e1']::uuid[]);
  sl_fremd uuid := testhilfe.benutzer('studioleitung', array['de000000-0000-0000-0000-0000000000e2']::uuid[]);
  rl uuid := testhilfe.benutzer('regionalleitung', array['de000000-0000-0000-0000-0000000000e1']::uuid[]);
  dv uuid; dv_aus uuid;
  k jsonb;
  n int;
begin
  dv := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1', true);
  dv_aus := testhilfe.mitarbeiter_anlegen(hr, 'de000000-0000-0000-0000-0000000000e1', 'de000000-0000-0000-0000-0000000000f1');
  update public.dienstverhaeltnis set eintritt = current_date - 30, austritt = current_date - 1 where id = dv_aus;

  perform testhilfe.als(hr);
  perform public.stunden_anpassen(dv, current_date + 30, 'vollzeit', 40, 5, 1500);
  k := public.akte_kopf(dv);
  perform testhilfe.pruefe(k ->> 'nachname' = 'Person' and k ->> 'funktion' = 'Servicekraft' and k ? 'arbeitsort'
    and k ? 'gesellschaft', 'Kopf mit Name, Funktion, Arbeitsort, GmbH');
  perform testhilfe.pruefe((k -> 'stand' ->> 'wochenstunden')::numeric = 20, 'aktueller Stand 20 Stunden');
  perform testhilfe.pruefe(jsonb_array_length(k -> 'kuenftig') = 1 and (k -> 'kuenftig' -> 0 ->> 'wochenstunden')::numeric = 40,
    'künftiger Stand 40 Stunden');
  perform testhilfe.pruefe(k -> 'nachweis_fehlt' ->> 0 = (current_date + 30)::text, 'Nachweis fehlt für die Anpassung');
  perform testhilfe.pruefe((k -> 'entgelt' ->> 'netto')::numeric = 1000 and (k ->> 'sv_nachreichen')::boolean, 'Entgelt und SV-Hinweis');
  perform testhilfe.pruefe((k -> 'onboarding' ->> 'gesamt')::int = 4 and (k -> 'onboarding' ->> 'erledigt')::int = 0, 'Onboarding 0 von 4');
  perform testhilfe.pruefe((k -> 'rechte' ->> 'buero')::boolean, 'Recht Büro gesetzt');

  select count(*) into n from public.offene_punkte() where dienstverhaeltnis_id = dv and art = 'onboarding';
  perform testhilfe.pruefe(n = 4, 'vier fehlende Onboarding-Unterlagen');
  select count(*) into n from public.offene_punkte() where dienstverhaeltnis_id = dv and art = 'nachweis_stunden';
  perform testhilfe.pruefe(n = 1, 'ein fehlender Nachweis zur Stundenanpassung');
  select count(*) into n from public.offene_punkte() where dienstverhaeltnis_id = dv and art = 'sv_nummer';
  perform testhilfe.pruefe(n = 1, 'Versicherungsnummer nachzureichen');
  perform public.stammdaten_aendern((select mitarbeiter_id from public.dienstverhaeltnis where id = dv), '{"ort": "Leoben"}', current_date, 'Umzug');
  perform testhilfe.pruefe((select beschreibung from public.offene_punkte() where dienstverhaeltnis_id = dv and art = 'nachweis_stammdaten') = 'Ort',
    'fehlender Nachweis zur Stammdatenänderung mit Feldname');
  select count(*) into n from public.offene_punkte() where dienstverhaeltnis_id = dv_aus;
  perform testhilfe.pruefe(n = 0, 'Ausgetretene erscheinen nicht');

  select count(*) into n from public.akte_protokoll(dv) where tabelle in ('dienstverhaeltnis', 'entgelt');
  perform testhilfe.pruefe(n >= 2, 'Protokoll enthält Dienstverhältnis und Entgelt');
  perform testhilfe.zurueck();

  perform testhilfe.als(verw);
  k := public.akte_kopf(dv);
  perform testhilfe.pruefe(k ? 'telefon' and not k ? 'stand' and not k ? 'entgelt' and not k ? 'onboarding' and not k ? 'geburtsdatum',
    'Verwaltung: nur Kontakt');
  perform testhilfe.zurueck();

  perform testhilfe.als(sl);
  k := public.akte_kopf(dv);
  perform testhilfe.pruefe(k ? 'onboarding' and not k ? 'entgelt' and not k ? 'stand', 'Studioleitung: Onboarding, kein Entgelt');
  perform testhilfe.pruefe((k -> 'rechte' ->> 'hochladen_onboarding')::boolean, 'Studioleitung darf Onboarding hochladen');
  select count(*) into n from public.offene_punkte() where dienstverhaeltnis_id = dv and art in ('nachweis_stunden', 'sv_nummer', 'nachweis_stammdaten');
  perform testhilfe.pruefe(n = 0, 'Studioleitung sieht keine Punkte zu Personendaten oder Lohnverrechnung');
  select count(*) into n from public.offene_punkte() where dienstverhaeltnis_id = dv and art = 'onboarding';
  perform testhilfe.pruefe(n = 4, 'Studioleitung sieht fehlende Onboarding-Unterlagen');
  perform testhilfe.zurueck();

  perform testhilfe.als(sl_fremd);
  perform testhilfe.erwarte_fehler(format('select public.akte_kopf(%L)', dv), 'Keine Berechtigung');
  select count(*) into n from public.offene_punkte() where dienstverhaeltnis_id = dv;
  perform testhilfe.pruefe(n = 0, 'fremdes Studio: keine Punkte');
  perform testhilfe.zurueck();

  perform testhilfe.als(rl);
  perform testhilfe.erwarte_fehler(format('select * from public.akte_protokoll(%L)', dv), 'Keine Berechtigung');
  perform testhilfe.zurueck();
end $$;
select 'alle Tests bestanden' as ergebnis;
rollback;
