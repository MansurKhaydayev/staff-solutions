-- Austritt, Storno und Mail-Knöpfe, Teil 2: melden, bestätigen, korrigieren.
-- Die Leitung meldet, das Büro bestätigt. Erst die Bestätigung setzt dienstverhaeltnis.austritt.
-- Nichts wird überschrieben: jede Änderung ist eine neue Fassung, die alte zeigt auf die neue (ersetzt_durch).

-- Neue Fassung zuerst verweisen, dann anlegen: der Verweis wird erst am Ende der Transaktion geprüft.
alter table public.austritt_meldung alter constraint austritt_meldung_ersetzt_durch_fkey deferrable initially deferred;

create or replace function app.darf_anlegen() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select r.darf_anlegen from public.profil p
                   join public.rollen_recht r on r.organisation_id = p.organisation_id and r.rolle = p.rolle
                   where p.user_id = (select auth.uid())), false)
$$;

-- gemeinsame Prüfung für den letzten Arbeitstag und die Art
create or replace function app.austritt_pruefen(p_dv public.dienstverhaeltnis, p_tag date, p_austrittsart text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_tag is null then raise exception 'Bitte den letzten Arbeitstag angeben.'; end if;
  if p_tag < p_dv.eintritt then raise exception 'Der letzte Arbeitstag darf nicht vor dem Dienstantritt liegen.'; end if;
  if p_tag > app.heute_wien() + interval '1 year' then
    raise exception 'Der letzte Arbeitstag darf höchstens ein Jahr in der Zukunft liegen.';
  end if;
  if p_austrittsart is null or not exists (select 1 from public.austrittsart a where a.organisation_id = p_dv.organisation_id
                                             and a.schluessel = p_austrittsart and a.aktiv) then
    raise exception 'Bitte die Art des Austritts wählen.';
  end if;
end $$;

create or replace function public.austritt_melden(
  p_dienstverhaeltnis_id uuid,
  p_art                  text,
  p_letzter_arbeitstag   date default null,
  p_austrittsart         text default null,
  p_notiz                text default null,
  p_gleich_bestaetigen   boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := app.organisation_id();
  v_dv  public.dienstverhaeltnis%rowtype;
  v_alt public.austritt_meldung%rowtype;
  v_neu uuid := gen_random_uuid();
  v_gleich boolean := coalesce(p_gleich_bestaetigen, false);
begin
  if v_org is null then raise exception 'Dein Zugang ist keiner Firma zugeordnet.'; end if;
  -- Zeile sperren: zwei gleichzeitige Meldungen für dieselbe Person laufen nacheinander
  select * into v_dv from public.dienstverhaeltnis where id = p_dienstverhaeltnis_id and organisation_id = v_org for update;
  if v_dv.id is null then raise exception 'Diese Person wurde nicht gefunden.'; end if;
  if not app.in_reichweite(v_dv.id) then raise exception 'Du bist für dieses Studio nicht zuständig.'; end if;
  if not (app.ist_buero() or app.darf_anlegen()) then
    raise exception 'Mit deinem Zugang kannst du keinen Austritt melden.';
  end if;
  if v_gleich and not app.ist_buero() then raise exception 'Das darf nur das Personalbüro.'; end if;
  if p_art is null or p_art not in ('austritt', 'nicht_angetreten') then raise exception 'Unbekannte Meldung.'; end if;
  if (app.aktuelle_meldung(v_dv.id)).id is not null or v_dv.austritt is not null then
    raise exception 'Für diese Person ist bereits ein Austritt oder „nicht angetreten“ gemeldet.';
  end if;

  if p_art = 'austritt' then
    perform app.austritt_pruefen(v_dv, p_letzter_arbeitstag, p_austrittsart);
  else
    if nullif(trim(p_notiz), '') is null then raise exception 'Bitte einen Grund angeben.'; end if;
    if app.heute_wien() < v_dv.eintritt then
      raise exception '„Nicht angetreten“ kann erst ab dem geplanten Dienstantritt gemeldet werden.';
    end if;
  end if;

  -- eine früher zurückgenommene Meldung wird von der neuen abgelöst
  select * into v_alt from public.austritt_meldung where dienstverhaeltnis_id = v_dv.id and ersetzt_durch is null;
  if v_alt.id is not null then
    update public.austritt_meldung set ersetzt_durch = v_neu, ersetzt_am = now() where id = v_alt.id;
  end if;

  insert into public.austritt_meldung (id, organisation_id, dienstverhaeltnis_id, art, letzter_arbeitstag, austrittsart, notiz,
    gemeldet_von, bestaetigt_von, bestaetigt_am)
  values (v_neu, v_org, v_dv.id, p_art,
    case when p_art = 'austritt' then p_letzter_arbeitstag end,
    case when p_art = 'austritt' then p_austrittsart end,
    nullif(trim(p_notiz), ''), auth.uid(),
    case when v_gleich then auth.uid() end, case when v_gleich then now() end);

  if v_gleich and p_art = 'austritt' then
    update public.dienstverhaeltnis set austritt = p_letzter_arbeitstag where id = v_dv.id;
  end if;
  return v_neu;
end $$;

create or replace function app.art_text(p_org uuid, p_schluessel text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select a.bezeichnung from public.austrittsart a where a.organisation_id = p_org and a.schluessel = p_schluessel),
                  p_schluessel)
$$;

create or replace function public.austritt_bestaetigen(
  p_meldung_id         uuid,
  p_letzter_arbeitstag date default null,
  p_austrittsart       text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := app.organisation_id();
  v_m   public.austritt_meldung%rowtype;
  v_dv  public.dienstverhaeltnis%rowtype;
  v_tag date; v_art text; v_abw text[] := '{}';
  v_neu uuid;
begin
  if not app.ist_buero() then raise exception 'Das darf nur das Personalbüro.'; end if;
  select * into v_m from public.austritt_meldung where id = p_meldung_id and organisation_id = v_org for update;
  if v_m.id is null then raise exception 'Diese Meldung wurde nicht gefunden.'; end if;
  if v_m.ersetzt_durch is not null or v_m.bestaetigt_am is not null or v_m.zurueckgenommen then
    raise exception 'Diese Meldung wurde inzwischen geändert. Bitte die Seite neu laden.';
  end if;
  select * into v_dv from public.dienstverhaeltnis where id = v_m.dienstverhaeltnis_id for update;

  if v_m.art = 'nicht_angetreten' then
    update public.austritt_meldung set bestaetigt_von = auth.uid(), bestaetigt_am = now() where id = v_m.id;
    return v_m.id;
  end if;

  v_tag := coalesce(p_letzter_arbeitstag, v_m.letzter_arbeitstag);
  v_art := coalesce(p_austrittsart, v_m.austrittsart);
  perform app.austritt_pruefen(v_dv, v_tag, v_art);
  if v_tag <> v_m.letzter_arbeitstag then
    v_abw := v_abw || ('Letzter Arbeitstag ' || to_char(v_tag, 'DD.MM.YYYY') || ' statt ' || to_char(v_m.letzter_arbeitstag, 'DD.MM.YYYY'));
  end if;
  if v_art <> v_m.austrittsart then
    v_abw := v_abw || ('Art: ' || app.art_text(v_org, v_art) || ' statt ' || app.art_text(v_org, v_m.austrittsart));
  end if;

  if cardinality(v_abw) = 0 then
    update public.austritt_meldung set bestaetigt_von = auth.uid(), bestaetigt_am = now() where id = v_m.id;
    v_neu := v_m.id;
  else
    v_neu := gen_random_uuid();
    update public.austritt_meldung set ersetzt_durch = v_neu, ersetzt_am = now() where id = v_m.id;
    insert into public.austritt_meldung (id, organisation_id, dienstverhaeltnis_id, art, letzter_arbeitstag, austrittsart, notiz,
      gemeldet_von, gemeldet_am, bestaetigt_von, bestaetigt_am, abweichung)
    values (v_neu, v_org, v_m.dienstverhaeltnis_id, v_m.art, v_tag, v_art, v_m.notiz,
      v_m.gemeldet_von, v_m.gemeldet_am, auth.uid(), now(), array_to_string(v_abw, '; '));
  end if;
  update public.dienstverhaeltnis set austritt = v_tag where id = v_dv.id;
  return v_neu;
end $$;

create or replace function public.austritt_korrigieren(
  p_meldung_id         uuid,
  p_grund              text,
  p_letzter_arbeitstag date default null,
  p_austrittsart       text default null,
  p_zuruecknehmen      boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := app.organisation_id();
  v_m   public.austritt_meldung%rowtype;
  v_dv  public.dienstverhaeltnis%rowtype;
  v_zurueck boolean := coalesce(p_zuruecknehmen, false);
  v_tag date; v_art text;
  v_neu uuid := gen_random_uuid();
begin
  if not app.ist_buero() then raise exception 'Das darf nur das Personalbüro.'; end if;
  if nullif(trim(p_grund), '') is null then raise exception 'Bitte einen Grund angeben.'; end if;
  select * into v_m from public.austritt_meldung where id = p_meldung_id and organisation_id = v_org for update;
  if v_m.id is null then raise exception 'Diese Meldung wurde nicht gefunden.'; end if;
  if v_m.ersetzt_durch is not null or v_m.zurueckgenommen then
    raise exception 'Diese Meldung wurde inzwischen geändert. Bitte die Seite neu laden.';
  end if;
  select * into v_dv from public.dienstverhaeltnis where id = v_m.dienstverhaeltnis_id for update;

  if not v_zurueck then
    if v_m.art = 'nicht_angetreten' then
      raise exception 'Bei „nicht angetreten“ ist nur Zurücknehmen möglich.';
    end if;
    v_tag := coalesce(p_letzter_arbeitstag, v_m.letzter_arbeitstag);
    v_art := coalesce(p_austrittsart, v_m.austrittsart);
    perform app.austritt_pruefen(v_dv, v_tag, v_art);
  end if;

  update public.austritt_meldung set ersetzt_durch = v_neu, ersetzt_am = now() where id = v_m.id;
  insert into public.austritt_meldung (id, organisation_id, dienstverhaeltnis_id, art, letzter_arbeitstag, austrittsart, notiz,
    gemeldet_von, gemeldet_am, bestaetigt_von, bestaetigt_am, zurueckgenommen, korrektur_grund)
  values (v_neu, v_org, v_m.dienstverhaeltnis_id, v_m.art,
    case when v_zurueck then v_m.letzter_arbeitstag else v_tag end,
    case when v_zurueck then v_m.austrittsart else v_art end,
    v_m.notiz, v_m.gemeldet_von, v_m.gemeldet_am, auth.uid(), now(), v_zurueck, trim(p_grund));

  update public.dienstverhaeltnis set austritt = case when v_zurueck or v_m.art = 'nicht_angetreten' then null else v_tag end
  where id = v_dv.id;
  return v_neu;
end $$;

create or replace function public.austritt_verlauf(p_dienstverhaeltnis_id uuid)
returns table (id uuid, art text, letzter_arbeitstag date, austrittsart text, austrittsart_text text, notiz text,
               gemeldet_von_email text, gemeldet_am timestamptz, bestaetigt_von_email text, bestaetigt_am timestamptz,
               abweichung text, zurueckgenommen boolean, korrektur_grund text, ersetzt boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_p boolean;
begin
  if not app.in_reichweite(p_dienstverhaeltnis_id) then raise exception 'Keine Berechtigung für diese Akte.'; end if;
  v_p := app.sieht('personendaten', app.standort_von(p_dienstverhaeltnis_id));
  return query
  select m.id, m.art, m.letzter_arbeitstag,
         case when v_p then m.austrittsart end,
         case when v_p then app.art_text(m.organisation_id, m.austrittsart) end,
         case when v_p then m.notiz end,
         g.email::text, m.gemeldet_am, b.email::text, m.bestaetigt_am,
         case when v_p then m.abweichung end, m.zurueckgenommen,
         case when v_p then m.korrektur_grund end, m.ersetzt_durch is not null
  from public.austritt_meldung m
  left join auth.users g on g.id = m.gemeldet_von
  left join auth.users b on b.id = m.bestaetigt_von
  where m.dienstverhaeltnis_id = p_dienstverhaeltnis_id and m.organisation_id = app.organisation_id()
  order by coalesce(m.bestaetigt_am, m.gemeldet_am), m.gemeldet_am;
end $$;

-- Akte-Kopf mit Status, Abmeldefrist und Recht „Austritt melden“
create or replace function public.akte_kopf(p_dienstverhaeltnis_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_dv   public.dienstverhaeltnis%rowtype;
  v_ma   public.mitarbeiter%rowtype;
  v_st   public.standort%rowtype;
  v_tag  date;
  v_k    boolean; v_p boolean; v_e boolean; v_l boolean; v_d boolean;
  v_kopf jsonb;
  v_stand public.vertragsstand%rowtype;
begin
  if not app.in_reichweite(p_dienstverhaeltnis_id) then raise exception 'Keine Berechtigung für diese Akte.'; end if;
  select * into v_dv from public.dienstverhaeltnis where id = p_dienstverhaeltnis_id;
  select * into v_ma from public.mitarbeiter where id = v_dv.mitarbeiter_id;
  select * into v_st from public.standort where id = v_dv.heimstandort_id;
  v_tag := greatest(current_date, v_dv.eintritt);
  v_k := app.sieht('kontakt', v_st.id);
  v_p := app.sieht('personendaten', v_st.id);
  v_e := app.sieht('entgelt', v_st.id);
  v_l := app.sieht('lohnverrechnung', v_st.id);
  v_d := app.sieht('dokumente', v_st.id);

  v_kopf := jsonb_build_object(
    'dienstverhaeltnis_id', v_dv.id, 'mitarbeiter_id', v_ma.id, 'vorname', v_ma.vorname, 'nachname', v_ma.nachname,
    'funktion', (select f.name from public.funktion f where f.id = v_dv.funktion_id),
    'arbeitsort', coalesce(v_st.vertragsbezeichnung, v_st.name), 'standort_id', v_st.id, 'standort_art', v_st.art,
    'gesellschaft', (select g.name from public.gesellschaft g where g.id = v_dv.gesellschaft_id),
    'eintritt', v_dv.eintritt, 'austritt', v_dv.austritt,
    'angemeldet', app.angemeldet(v_dv.id), 'dringend_grund', v_dv.dringend_grund,
    'status', app.dv_status(v_dv.id), 'meldung_id', (app.aktuelle_meldung(v_dv.id)).id,
    'abmeldung_bis', case when app.dv_status(v_dv.id) = 'austritt_bestaetigt'
      then v_dv.austritt + (select o.abmeldefrist_tage from public.organisation o where o.id = v_dv.organisation_id) end,
    'rechte', jsonb_build_object('kontakt', v_k, 'personendaten', v_p, 'entgelt', v_e, 'lohnverrechnung', v_l,
      'dokumente', v_d, 'buero', app.ist_buero(), 'hochladen_onboarding', app.darf_hochladen('onboarding', v_dv.id),
      'austritt_melden', app.ist_buero() or app.darf_anlegen()));

  if v_k then
    v_kopf := v_kopf || jsonb_build_object('telefon', v_ma.telefon, 'email', v_ma.email);
  end if;
  if v_p then
    v_stand := app.stand_am(v_dv.id, v_tag);
    v_kopf := v_kopf || jsonb_build_object(
      'befristet_bis', v_dv.befristet_bis,
      'anrede', v_ma.anrede, 'geburtsdatum', v_ma.geburtsdatum, 'strasse', v_ma.strasse, 'plz', v_ma.plz, 'ort', v_ma.ort,
      'stand', jsonb_build_object('id', v_stand.id, 'gueltig_ab', v_stand.gueltig_ab, 'beschaeftigungsart', v_stand.beschaeftigungsart,
        'wochenstunden', v_stand.wochenstunden, 'arbeitstage_woche', v_stand.arbeitstage_woche),
      'kuenftig', coalesce((select jsonb_agg(jsonb_build_object('gueltig_ab', v.gueltig_ab, 'beschaeftigungsart', v.beschaeftigungsart,
          'wochenstunden', v.wochenstunden, 'arbeitstage_woche', v.arbeitstage_woche) order by v.gueltig_ab)
        from public.vertragsstand v where v.dienstverhaeltnis_id = v_dv.id and v.storniert_am is null and v.gueltig_ab > v_tag), '[]'),
      'nachweis_fehlt', coalesce((select jsonb_agg(t) from app.staende_ohne_nachweis(v_dv.id) t), '[]'));
  end if;
  if v_e then
    v_kopf := v_kopf || jsonb_build_object(
      'entgelt', (select jsonb_build_object('netto', e.netto, 'brutto', e.brutto, 'quelle', e.quelle, 'gueltig_ab', e.gueltig_ab)
        from public.entgelt e where e.dienstverhaeltnis_id = v_dv.id and e.storniert_am is null and e.gueltig_ab <= v_tag
        order by e.gueltig_ab desc limit 1),
      'zulagen', coalesce((select jsonb_agg(jsonb_build_object('art', z.art, 'netto', z.netto, 'gueltig_ab', z.gueltig_ab))
        from public.zulage z where z.dienstverhaeltnis_id = v_dv.id and (z.gueltig_bis is null or z.gueltig_bis >= current_date)), '[]'),
      'sonderzahlung', v_dv.sonderzahlung);
  end if;
  if v_l then
    v_kopf := v_kopf || jsonb_build_object('sv_nachreichen',
      coalesce((select s.sv_nummer_nachreichen from public.mitarbeiter_sensibel s where s.mitarbeiter_id = v_ma.id), false));
  end if;
  if v_d then
    v_kopf := v_kopf || jsonb_build_object('onboarding', (
      select jsonb_build_object(
        'gesamt', count(*),
        'erledigt', count(*) filter (where o.status not in ('fehlt', 'klaerung')),
        'fehlt', coalesce(jsonb_agg(o.bezeichnung order by o.reihenfolge) filter (where o.status = 'fehlt'), '[]'),
        'klaerung', coalesce(jsonb_agg(o.bezeichnung order by o.reihenfolge) filter (where o.status = 'klaerung'), '[]'))
      from public.onboarding_stand(v_dv.id) o));
  end if;
  return v_kopf;
end $$;

-- Status je Dienstverhältnis für Liste und Startseite (eigene Funktion, damit mitarbeiter_verzeichnis
-- nicht gelöscht und neu angelegt werden muss). Gleiche Reichweite wie mitarbeiter_verzeichnis.
create or replace function public.mitarbeiter_status()
returns table (dienstverhaeltnis_id uuid, status text, austritt date)
language sql stable security definer set search_path = '' as $$
  select v.dienstverhaeltnis_id, app.dv_status(v.dienstverhaeltnis_id), v.austritt
  from public.mitarbeiter_verzeichnis() v
$$;

-- Mappe nach Austritt bzw. „nicht angetreten“ geschlossen
create or replace function public.mappe_inhalt(p_dienstverhaeltnis_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_dv     public.dienstverhaeltnis%rowtype;
  v_dz     public.dokument%rowtype;
  v_inhalt jsonb;
  v_schritte jsonb := '[]';
  v_frueh  date;
  o        record;
begin
  select * into v_dv from public.dienstverhaeltnis where id = p_dienstverhaeltnis_id and organisation_id = app.organisation_id();
  if v_dv.id is null or not app.in_reichweite(v_dv.id)
     or not (app.ist_buero() or (app.rolle() in ('studioleitung', 'regionalleitung') and app.sieht('dokumente', v_dv.heimstandort_id))) then
    raise exception 'Keine Berechtigung für diese Mappe.';
  end if;
  if not app.dv_aktiv(v_dv.id) then
    raise exception 'Diese Person ist nicht mehr beschäftigt. Die Mappe ist geschlossen.';
  end if;

  v_dz := app.aktueller_dienstzettel(v_dv.id);
  if v_dz.id is not null then
    v_schritte := v_schritte || jsonb_build_object('art', 'dienstzettel', 'status', v_dz.status, 'dokument_id', v_dz.id,
      'papier', v_dz.papier, 'fassung', v_dz.inhalt_hash);
  else
    v_inhalt := app.dienstzettel_inhalt(v_dv.id);
    v_schritte := v_schritte || jsonb_build_object('art', 'dienstzettel', 'status', 'offen',
      'fassung', app.fassung(v_inhalt), 'inhalt', v_inhalt);
  end if;

  for o in select * from public.onboarding_stand(v_dv.id) loop
    if o.status = 'fehlt' then
      v_inhalt := app.onboarding_inhalt(v_dv.id, o.unterlage_id);
      v_schritte := v_schritte || jsonb_build_object('art', 'onboarding', 'unterlage_id', o.unterlage_id, 'status', 'offen',
        'pflicht', o.pflicht, 'fassung', app.fassung(v_inhalt), 'inhalt', v_inhalt);
    else
      v_schritte := v_schritte || jsonb_build_object('art', 'onboarding', 'unterlage_id', o.unterlage_id,
        'status', case when o.status = 'erledigt' then 'abgeschlossen' else 'abgelehnt' end,
        'dokument_id', o.dokument_id, 'titel', o.bezeichnung,
        'fassung', (select x.inhalt_hash from public.dokument x where x.id = o.dokument_id));
    end if;
  end loop;

  v_frueh := app.fruehester_dienstantritt(v_dv.organisation_id, app.jetzt_wien());
  return jsonb_build_object(
    'dienstverhaeltnis_id', v_dv.id,
    'organisation_id', v_dv.organisation_id,
    'ort', app.unterschrift_ort(v_dv.id),
    'name', (select m.vorname || ' ' || m.nachname from public.mitarbeiter m where m.id = v_dv.mitarbeiter_id),
    'eintritt', v_dv.eintritt,
    'frist', jsonb_build_object('fruehester', v_frueh,
      'verletzt', v_dv.eintritt < v_frueh and v_dv.dringend_grund is null
        and not exists (select 1 from public.dokument x where x.dienstverhaeltnis_id = v_dv.id and x.typ = 'dienstzettel'),
      'dringend_grund', v_dv.dringend_grund),
    'schritte', v_schritte);
end $$;

revoke execute on function app.darf_anlegen(), app.austritt_pruefen(public.dienstverhaeltnis, date, text), app.art_text(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.austritt_melden(uuid, text, date, text, text, boolean), public.austritt_bestaetigen(uuid, date, text),
  public.austritt_korrigieren(uuid, text, date, text, boolean), public.austritt_verlauf(uuid), public.mitarbeiter_status()
  from public, anon;
grant execute on function public.austritt_melden(uuid, text, date, text, text, boolean), public.austritt_bestaetigen(uuid, date, text),
  public.austritt_korrigieren(uuid, text, date, text, boolean), public.austritt_verlauf(uuid), public.mitarbeiter_status()
  to authenticated;
