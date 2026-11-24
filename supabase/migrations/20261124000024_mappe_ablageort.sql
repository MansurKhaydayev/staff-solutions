-- Edge Function braucht Organisation, Dienstverhältnis und Ort für Ablagepfade und PDF

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

  v_dz := app.aktueller_dienstzettel(v_dv.id);
  if v_dz.id is not null then
    v_schritte := v_schritte || jsonb_build_object('art', 'dienstzettel', 'status', v_dz.status, 'dokument_id', v_dz.id,
      'papier', v_dz.papier);
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
        'dokument_id', o.dokument_id, 'titel', o.bezeichnung);
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

create or replace function public.arbeitgeber_inhalt(p_dokument_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.dokument%rowtype := app.dienstzettel_fuer_arbeitgeber(p_dokument_id);
  u public.unterschrift%rowtype;
begin
  if v.status <> 'unterschrieben' or v.ersetzt_durch is not null then
    raise exception 'Dieser Dienstzettel ist schon fertig unterschrieben.';
  end if;
  select * into u from public.unterschrift where dokument_id = v.id and rolle = 'mitarbeiter' order by zeitpunkt limit 1;
  return jsonb_build_object(
    'dokument_id', v.id,
    'organisation_id', v.organisation_id,
    'dienstverhaeltnis_id', v.dienstverhaeltnis_id,
    'fassung', v.inhalt_hash,
    'inhalt', v.inhalt,
    'mitarbeiter', jsonb_build_object('png_pfad', u.datei_pfad, 'ort', u.ort, 'datum', u.zeitpunkt),
    'arbeitgeber_ort', (select g.ort from public.dienstverhaeltnis d join public.gesellschaft g on g.id = d.gesellschaft_id
                        where d.id = v.dienstverhaeltnis_id));
end $$;
