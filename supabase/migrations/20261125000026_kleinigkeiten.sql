-- Kleinigkeiten aus der Prüfung der Unterschriftsmappe:
-- „angemeldet“ nur für die eigene Firma, Hinweis an die Arbeitgeber-Unterschrift bei geänderten Daten.
-- Ohne drop/revoke: bestehende Funktionen werden mit gleicher Signatur neu angelegt, die Rechte bleiben.

-- Angemeldet = eine Anmeldebestätigung (Kategorie „anmeldung“) mit Datei liegt in der Akte, nur in der eigenen Firma
create or replace function app.angemeldet(p_dv uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.dokument x where x.dienstverhaeltnis_id = p_dv and x.kategorie = 'anmeldung'
                 and x.datei_pfad is not null and x.ersetzt_durch is null
                 and x.organisation_id = app.organisation_id())
$$;

-- Was hat sich seit der Mitarbeiter-Unterschrift dieses Dienstzettels geändert? Anzeigenamen, ohne Doppelte.
-- Ohne security definer: Aufgerufen aus arbeitgeber_inhalt / arbeitgeber_offen_hinweise läuft sie mit deren Rechten,
-- direkt aufgerufen gelten die Zeilenrechte der aufrufenden Person.
create or replace function app.dienstzettel_aenderungen(p_dokument_id uuid) returns text[]
language plpgsql stable set search_path = '' as $$
declare
  v       public.dokument%rowtype;
  v_seit  timestamptz;
  v_neu   jsonb;
  v_liste text[];
  v_zeile jsonb;
  v_alt   jsonb;
  v_namen jsonb := '{"anrede":"Anrede","vorname":"Vorname","nachname":"Nachname","geburtsdatum":"Geburtsdatum",
    "strasse":"Straße","plz":"PLZ","ort":"Ort","telefon":"Telefonnummer","email":"E-Mail-Adresse",
    "sv_nummer":"Versicherungsnummer","iban":"IBAN","bic":"BIC","staatsangehoerigkeit":"Staatsangehörigkeit"}';
  v_reihe text[] := array['anrede', 'vorname', 'nachname', 'geburtsdatum', 'strasse', 'plz', 'ort', 'telefon', 'email',
    'staatsangehoerigkeit', 'sv_nummer', 'iban', 'bic'];
begin
  select * into v from public.dokument where id = p_dokument_id;
  if v.id is null then return '{}'; end if;
  select min(u.zeitpunkt) into v_seit from public.unterschrift u where u.dokument_id = v.id and u.rolle = 'mitarbeiter';
  v_seit := coalesce(v_seit, v.hochgeladen_am, v.created_at);

  -- 1. Stammdatenänderungen seit der Unterschrift (auch Daten, die nicht auf dem Dienstzettel stehen, z. B. IBAN)
  select coalesce(array_agg(v_namen ->> k.feld order by k.nr), '{}') into v_liste
  from unnest(v_reihe) with ordinality k(feld, nr)
  where exists (select 1 from public.stammdaten_aenderung a
                join public.dienstverhaeltnis d on d.mitarbeiter_id = a.mitarbeiter_id and d.organisation_id = a.organisation_id
                where d.id = v.dienstverhaeltnis_id and a.feld = k.feld and a.created_at > v_seit);

  -- 2. Weicht der Dienstzettel mit den heutigen Daten vom unterschriebenen ab? (z. B. Vertragstexte, Firma, Arbeitszeit)
  if v.inhalt is not null then
    v_neu := app.dienstzettel_inhalt(v.dienstverhaeltnis_id);
    if app.fassung(v_neu) is distinct from v.inhalt_hash then
      for v_zeile in select z from jsonb_array_elements(v_neu -> 'felder') z loop
        select z into v_alt from jsonb_array_elements(v.inhalt -> 'felder') z where z ->> 0 = v_zeile ->> 0;
        -- Zeile „Arbeitnehmer/in“ ändert sich durch Stammdaten, die schon oben genannt sind
        if v_alt is distinct from v_zeile
           and not (v_zeile ->> 0 = 'Arbeitnehmer/in' and cardinality(v_liste) > 0)
           and not (v_zeile ->> 0 = any(v_liste)) then
          v_liste := v_liste || (v_zeile ->> 0);
        end if;
      end loop;
      -- weggefallene Zeilen (z. B. Leiterzulage)
      v_liste := v_liste || coalesce((select array_agg(z ->> 0) from jsonb_array_elements(v.inhalt -> 'felder') z
        where not exists (select 1 from jsonb_array_elements(v_neu -> 'felder') y where y ->> 0 = z ->> 0)
          and not (z ->> 0 = any(v_liste))), '{}');
      if v_neu -> 'abschnitte' is distinct from v.inhalt -> 'abschnitte' then
        v_liste := v_liste || 'Vertragstexte'::text;
      end if;
      if cardinality(v_liste) = 0 then
        v_liste := array['Dienstzettel-Inhalt'];
      end if;
    end if;
  end if;
  return v_liste;
end $$;

-- Hinweise für die Liste „Zu unterschreiben“ (gleiche Dokumente und Rechte wie arbeitgeber_offen)
create or replace function public.arbeitgeber_offen_hinweise()
returns table (dokument_id uuid, geaendert boolean, geaenderte_felder text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.darf_arbeitgeber_unterschreiben() then
    raise exception 'Keine Berechtigung: Arbeitgeber-Unterschriften sind dir nicht freigegeben.';
  end if;
  return query
    select o.dokument_id, cardinality(f.felder) > 0, f.felder
    from public.arbeitgeber_offen() o
    cross join lateral (select app.dienstzettel_aenderungen(o.dokument_id) as felder) f;
end $$;
grant execute on function public.arbeitgeber_offen_hinweise() to authenticated;

-- Inhalt für die Arbeitgeber-Unterschrift, jetzt mit „geaendert“ und „geaenderte_felder“ (sonst wie in Migration 025)
create or replace function public.arbeitgeber_inhalt(p_dokument_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.dokument%rowtype := app.dienstzettel_fuer_arbeitgeber(p_dokument_id);
  u public.unterschrift%rowtype;
  w public.dokument%rowtype;
  v_felder text[];
begin
  -- Schon gegengezeichnet? Dann das fertige Dokument nennen (erneutes Absenden nach Netzfehler)
  if v.ersetzt_durch is not null then
    select * into w from public.dokument where id = v.ersetzt_durch;
    if w.status = 'abgeschlossen' and w.neu_angefordert_am is null and w.inhalt_hash = v.inhalt_hash then
      return jsonb_build_object('erledigt', true, 'dokument_id', w.id, 'fassung', w.inhalt_hash);
    end if;
  end if;
  if v.status <> 'unterschrieben' or v.ersetzt_durch is not null then
    raise exception 'Dieser Dienstzettel ist schon fertig unterschrieben.';
  end if;
  select * into u from public.unterschrift where dokument_id = v.id and rolle = 'mitarbeiter' order by zeitpunkt limit 1;
  v_felder := app.dienstzettel_aenderungen(v.id);
  return jsonb_build_object(
    'dokument_id', v.id,
    'organisation_id', v.organisation_id,
    'dienstverhaeltnis_id', v.dienstverhaeltnis_id,
    'fassung', v.inhalt_hash,
    'inhalt', v.inhalt,
    'mitarbeiter', jsonb_build_object('png_pfad', u.datei_pfad, 'ort', u.ort, 'datum', u.zeitpunkt),
    'arbeitgeber_ort', (select g.ort from public.dienstverhaeltnis d join public.gesellschaft g on g.id = d.gesellschaft_id
                        where d.id = v.dienstverhaeltnis_id),
    'geaendert', cardinality(v_felder) > 0,
    'geaenderte_felder', to_jsonb(v_felder));
end $$;
