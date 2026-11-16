-- =====================================================================
-- Staff-Solutions - Migration 006
-- Dienstzettel-Erfassung: optionale Leiterzulage (netto) wird als Zulage
-- gespeichert. Sie steht nicht im Dienstvertrag, sondern führt zu einer
-- eigenen Einzelvereinbarung (wie das 13./14. Gehalt).
-- =====================================================================

drop function public.dienstzettel_erfassen(uuid, uuid, text, text, date, text, numeric, numeric,
  text, date, text, text, text, text, text, text, text, text, text, int, boolean);

create function public.dienstzettel_erfassen(
  p_standort_id          uuid,
  p_funktion_id          uuid,
  p_vorname              text,
  p_nachname             text,
  p_eintritt             date,
  p_beschaeftigungsart   text,
  p_wochenstunden        numeric,
  p_netto                numeric,
  p_anrede               text    default null,
  p_geburtsdatum         date    default null,
  p_strasse              text    default null,
  p_plz                  text    default null,
  p_ort                  text    default null,
  p_telefon              text    default null,
  p_email                text    default null,
  p_staatsangehoerigkeit text    default null,
  p_sv_nummer            text    default null,
  p_iban                 text    default null,
  p_bic                  text    default null,
  p_arbeitstage_woche    int     default null,
  p_sonderzahlung        boolean default false,
  p_leiterzulage_netto   numeric default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org      uuid := app.organisation_id();
  v_rolle    text := app.rolle();
  v_gmbh     uuid;
  v_zone     uuid;
  v_brutto   numeric;
  v_ma       uuid;
  v_dv       uuid;
begin
  if v_org is null then
    raise exception 'Kein Profil gefunden';
  end if;

  select s.gesellschaft_id, s.tarifzone_id into v_gmbh, v_zone
  from public.standort s
  where s.id = p_standort_id and s.organisation_id = v_org;
  if v_gmbh is null then
    raise exception 'Studio nicht gefunden';
  end if;

  if not (v_rolle in ('admin', 'geschaeftsfuehrung', 'hr')
          or (v_rolle in ('studioleitung', 'regionalleitung')
              and exists (select 1 from public.zustaendigkeit z
                          where z.user_id = (select auth.uid())
                            and z.standort_id = p_standort_id))) then
    raise exception 'Keine Berechtigung für dieses Studio';
  end if;

  if p_leiterzulage_netto is not null and p_leiterzulage_netto <= 0 then
    raise exception 'Leiterzulage muss größer als 0 sein oder leer bleiben';
  end if;

  select b.brutto into v_brutto
  from public.brutto_tabelle b
  where b.organisation_id = v_org and b.tarifzone_id = v_zone
    and b.netto = p_netto and b.gueltig_ab <= p_eintritt
  order by b.gueltig_ab desc
  limit 1;

  insert into public.mitarbeiter (organisation_id, anrede, vorname, nachname, geburtsdatum,
                                  strasse, plz, ort, telefon, email)
  values (v_org, p_anrede, p_vorname, p_nachname, p_geburtsdatum,
          p_strasse, p_plz, p_ort, p_telefon, p_email)
  returning id into v_ma;

  insert into public.mitarbeiter_sensibel (mitarbeiter_id, organisation_id, sv_nummer,
                                           iban, bic, staatsangehoerigkeit)
  values (v_ma, v_org, nullif(replace(p_sv_nummer, ' ', ''), ''),
          nullif(upper(replace(p_iban, ' ', '')), ''), nullif(upper(trim(p_bic)), ''),
          p_staatsangehoerigkeit);

  insert into public.dienstverhaeltnis (organisation_id, mitarbeiter_id, gesellschaft_id,
         heimstandort_id, funktion_id, beschaeftigungsart, wochenstunden,
         arbeitstage_woche, sonderzahlung, eintritt)
  values (v_org, v_ma, v_gmbh, p_standort_id, p_funktion_id, p_beschaeftigungsart,
          p_wochenstunden, p_arbeitstage_woche, p_sonderzahlung, p_eintritt)
  returning id into v_dv;

  insert into public.entgelt (organisation_id, dienstverhaeltnis_id, netto, brutto, quelle, gueltig_ab)
  values (v_org, v_dv, p_netto, v_brutto,
          case when v_brutto is null then 'offen' else 'tabelle' end, p_eintritt);

  if p_leiterzulage_netto is not null then
    insert into public.zulage (organisation_id, dienstverhaeltnis_id, art, netto, gueltig_ab)
    values (v_org, v_dv, 'Leiterzulage', p_leiterzulage_netto, p_eintritt);
  end if;

  return v_dv;
end $$;

revoke execute on function public.dienstzettel_erfassen from public, anon;
grant  execute on function public.dienstzettel_erfassen to authenticated;

-- Welche Einzelvereinbarungen braucht ein Dienstverhältnis?
-- (Sonderzahlung laut Dienstzettel, laufende Zulagen)
create or replace view public.benoetigte_einzelvereinbarungen
with (security_invoker = true) as
select d.organisation_id, d.id as dienstverhaeltnis_id, 'Sonderzahlungen'::text as art,
       null::numeric as netto, d.eintritt as gueltig_ab
from public.dienstverhaeltnis d
where d.sonderzahlung
union all
select z.organisation_id, z.dienstverhaeltnis_id, z.art, z.netto, z.gueltig_ab
from public.zulage z
where z.gueltig_bis is null or z.gueltig_bis >= current_date;

grant select on public.benoetigte_einzelvereinbarungen to authenticated;
