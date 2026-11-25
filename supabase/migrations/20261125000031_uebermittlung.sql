-- Austritt, Storno und Mail-Knöpfe, Teil 3: Übermittlung an die Lohnverrechner (Sammelmail) und neue offene Punkte.

-- 1. Sammelversand: wer hat wann welche Unterlagen an welchen Lohnverrechner geschickt
create table public.sammelversand (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisation(id),
  lohnverrechner_id uuid,
  gesendet_am       timestamptz not null default now(),
  gesendet_von      uuid references auth.users(id),
  dokument_ids      uuid[] not null,
  foreign key (lohnverrechner_id, organisation_id) references public.lohnverrechner (id, organisation_id)
);
create index on public.sammelversand (organisation_id);
create index on public.sammelversand (lohnverrechner_id, organisation_id);
create index on public.sammelversand (gesendet_von);
alter table public.sammelversand enable row level security;
create policy buero_lesen on public.sammelversand for select to authenticated
  using (organisation_id = (select app.organisation_id()) and (select app.ist_buero()));
grant select on public.sammelversand to authenticated;
create trigger nur_ueber_funktionen before insert or update on public.sammelversand
  for each row execute function app.nur_ueber_funktionen();
create trigger loeschen_verboten before delete on public.sammelversand
  for each row execute function app.loeschen_verboten();
create trigger audit_sammelversand after insert or update or delete on public.sammelversand
  for each row execute function app.audit();

-- 2. Was muss an den Lohnverrechner? (je Dienstverhältnis höchstens eine Meldung, dazu die Anmeldung)
-- Die jüngste Fassung einer Meldung (auch eine zurückgenommene)
create or replace function app.letzte_meldung(p_dv uuid) returns public.austritt_meldung
language sql stable security definer set search_path = '' as $$
  select m.* from public.austritt_meldung m where m.dienstverhaeltnis_id = p_dv and m.ersetzt_durch is null
$$;

-- Art der fälligen Meldung an den Lohnverrechner: abmeldung, storno, korrektur oder null
create or replace function app.meldung_art(p_meldung public.austritt_meldung) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_vorher boolean;
begin
  if p_meldung.id is null or p_meldung.bestaetigt_am is null then return null; end if;
  -- wurde zu einer früheren Fassung schon etwas übermittelt? Dann ist das eine Korrektur.
  select exists (select 1 from public.dokument x join public.austritt_meldung a on a.id = x.austritt_meldung_id
                 where a.dienstverhaeltnis_id = p_meldung.dienstverhaeltnis_id and a.id <> p_meldung.id
                   and x.uebermittelt_am is not null) into v_vorher;
  if v_vorher then return 'korrektur'; end if;
  if p_meldung.zurueckgenommen then return null; end if;
  if p_meldung.art = 'austritt' then return 'abmeldung'; end if;
  -- nicht angetreten: Storno nur, wenn schon angemeldet oder die Anmeldung schon beim Lohnverrechner ist
  if app.bestaetigung_liegt_vor(p_meldung.dienstverhaeltnis_id, 'anmeldung')
     or exists (select 1 from public.dokument x where x.dienstverhaeltnis_id = p_meldung.dienstverhaeltnis_id
                and x.typ = 'dienstzettel' and x.uebermittelt_am is not null) then
    return 'storno';
  end if;
  return null;
end $$;

create or replace function public.uebermittlung_offen()
returns table (lohnverrechner_id uuid, lohnverrechner_name text, lohnverrechner_email text, dienstverhaeltnis_id uuid,
               vorname text, nachname text, gesellschaft text, art text, dokument_id uuid, meldung_id uuid, datum date)
language sql stable security definer set search_path = '' as $$
  with dv as (
    select d.id, d.eintritt, d.austritt, m.vorname, m.nachname, g.name as gmbh, l.id as lv_id,
           coalesce(l.name, 'Kein Lohnverrechner hinterlegt') as lv_name, l.email as lv_email
    from public.dienstverhaeltnis d
    join public.mitarbeiter m on m.id = d.mitarbeiter_id
    join public.gesellschaft g on g.id = d.gesellschaft_id
    left join public.lohnverrechner l on l.id = g.lohnverrechner_id
    where d.organisation_id = app.organisation_id() and app.ist_buero()
  ),
  anmeldung as (
    select dv.*, 'anmeldung'::text as art, x.id as dok, null::uuid as meld, dv.eintritt as datum
    from dv
    join public.dokument x on x.dienstverhaeltnis_id = dv.id and x.typ = 'dienstzettel' and x.status = 'abgeschlossen'
      and x.ersetzt_durch is null and x.neu_angefordert_am is null and x.uebermittelt_am is null
    where app.dv_status(dv.id) not in ('nicht_angetreten', 'storno_ausstaendig', 'nicht_angetreten_gemeldet')
  ),
  meldung as (
    select dv.*, app.meldung_art(lm.r) as art, (lm.r).id as meld, coalesce((lm.r).letzter_arbeitstag, dv.eintritt) as datum
    from dv cross join lateral (select app.letzte_meldung(dv.id) as r) lm
    where (lm.r).id is not null
  ),
  mit_pdf as (
    select me.*, x.id as dok, x.uebermittelt_am
    from meldung me
    left join public.dokument x on x.austritt_meldung_id = me.meld and x.ersetzt_durch is null
    where me.art is not null
  )
  select lv_id, lv_name, lv_email, id, vorname, nachname, gmbh, art, dok, meld, datum from anmeldung
  union all
  select lv_id, lv_name, lv_email, id, vorname, nachname, gmbh, art, dok, meld, datum from mit_pdf where uebermittelt_am is null
  order by 2, 6, 5
$$;

create or replace function public.uebermittlung_vermerken(p_dokument_ids uuid[])
returns table (sammelversand_id uuid, lohnverrechner_id uuid, vermerkt int)
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := app.organisation_id();
  r record;
  v_id uuid;
begin
  if not app.ist_buero() then raise exception 'Das darf nur das Personalbüro.'; end if;
  -- nur, was noch offen ist (inzwischen ersetzte oder schon vermerkte Unterlagen bleiben unverändert)
  for r in
    select g.lohnverrechner_id as lv, array_agg(x.id order by x.id) as ids
    from public.dokument x
    join public.dienstverhaeltnis d on d.id = x.dienstverhaeltnis_id
    join public.gesellschaft g on g.id = d.gesellschaft_id
    where x.id = any(p_dokument_ids) and x.organisation_id = v_org
      and x.uebermittelt_am is null and x.ersetzt_durch is null
      and ((x.typ = 'dienstzettel' and x.status = 'abgeschlossen' and x.neu_angefordert_am is null)
           or x.typ in ('austrittsmeldung', 'stornomeldung', 'korrekturmeldung'))
    group by g.lohnverrechner_id
  loop
    update public.dokument set uebermittelt_am = now(), uebermittelt_von = auth.uid()
    where id = any(r.ids) and uebermittelt_am is null;
    insert into public.sammelversand (organisation_id, lohnverrechner_id, gesendet_von, dokument_ids)
    values (v_org, r.lv, auth.uid(), r.ids) returning id into v_id;
    sammelversand_id := v_id; lohnverrechner_id := r.lv; vermerkt := cardinality(r.ids);
    return next;
  end loop;
end $$;

-- 3. Abschrift der Abmeldung an den Mitarbeiter vermerken
create or replace function public.abmeldung_aushaendigen(p_dokument_id uuid, p_art text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.dokument%rowtype;
begin
  if not app.ist_buero() then raise exception 'Das darf nur das Personalbüro.'; end if;
  if coalesce(p_art, '') not in ('ausdruck', 'email') then raise exception 'Bitte Ausdruck oder E-Mail wählen.'; end if;
  select * into v from public.dokument where id = p_dokument_id and organisation_id = app.organisation_id()
    and kategorie = 'abmeldung' and datei_pfad is not null and ersetzt_durch is null for update;
  if v.id is null then raise exception 'Die Abmeldebestätigung wurde nicht gefunden.'; end if;
  update public.dokument set ausgehaendigt_am = now(), ausgehaendigt_art = p_art where id = v.id and ausgehaendigt_am is null;
end $$;

-- 4. Offene Punkte: aktive Liste nach Status, dazu Austritt, Abmeldung, Storno, Abschrift
create or replace function public.offene_punkte()
returns table (dienstverhaeltnis_id uuid, vorname text, nachname text, standort_id uuid, art text, beschreibung text, datum date)
language sql stable security definer set search_path = '' as $$
  with aktiv as (
    select d.id, d.mitarbeiter_id, d.heimstandort_id, d.eintritt, d.dringend_grund, m.vorname, m.nachname
    from public.dienstverhaeltnis d
    join public.mitarbeiter m on m.id = d.mitarbeiter_id
    where d.organisation_id = app.organisation_id()
      and app.in_reichweite(d.id)
      and app.dv_aktiv(d.id)
  ),
  -- erst filtern, dann die Checkliste holen (onboarding_stand wirft ohne Recht einen Fehler)
  mit_dokumenten as materialized (
    select * from aktiv where app.sieht('dokumente', heimstandort_id)
  )
  -- Onboarding fehlt / Klärung offen
  select a.id, a.vorname, a.nachname, a.heimstandort_id,
         case o.status when 'fehlt' then 'onboarding' else 'klaerung' end, o.bezeichnung, null::date
  from mit_dokumenten a
  cross join lateral public.onboarding_stand(a.id) o
  where o.status in ('fehlt', 'klaerung')
  union all
  -- Stundenanpassung ohne Nachweis
  select a.id, a.vorname, a.nachname, a.heimstandort_id, 'nachweis_stunden', 'Stundenanpassung', t
  from aktiv a
  cross join lateral app.staende_ohne_nachweis(a.id) t
  where app.sieht('personendaten', a.heimstandort_id)
  union all
  -- Stammdatenänderung ohne Nachweis
  select a.id, a.vorname, a.nachname, a.heimstandort_id, 'nachweis_stammdaten',
         string_agg(case s.feld when 'anrede' then 'Anrede' when 'vorname' then 'Vorname' when 'nachname' then 'Nachname'
           when 'geburtsdatum' then 'Geburtsdatum' when 'strasse' then 'Straße' when 'plz' then 'PLZ' when 'ort' then 'Ort'
           when 'telefon' then 'Telefon' when 'email' then 'E-Mail' when 'sv_nummer' then 'Versicherungsnummer'
           when 'iban' then 'IBAN' when 'bic' then 'BIC' else 'Staatsangehörigkeit' end, ', ' order by s.feld),
         min(s.gueltig_ab)
  from aktiv a
  join public.dokument x on x.dienstverhaeltnis_id = a.id and x.kategorie in ('nachweis_personendaten', 'nachweis_lohnverrechnung')
    and x.datei_pfad is null and x.ersetzt_durch is null
  join public.stammdaten_aenderung s on s.dokument_id = x.id
  where app.sieht('dokumente', a.heimstandort_id) and app.sieht(s.stufe, a.heimstandort_id)
  group by a.id, a.vorname, a.nachname, a.heimstandort_id, x.id
  union all
  -- Versicherungsnummer nachreichen
  select a.id, a.vorname, a.nachname, a.heimstandort_id, 'sv_nummer', 'Versicherungsnummer nachreichen', null::date
  from aktiv a
  join public.mitarbeiter_sensibel s on s.mitarbeiter_id = a.mitarbeiter_id and s.sv_nummer_nachreichen
  where app.sieht('lohnverrechnung', a.heimstandort_id)
  union all
  -- Dienstzettel fehlt (oder soll neu unterschrieben werden)
  select a.id, a.vorname, a.nachname, a.heimstandort_id, 'dienstzettel',
         case when exists (select 1 from public.dokument x where x.dienstverhaeltnis_id = a.id and x.typ = 'dienstzettel'
                             and x.neu_angefordert_am is not null and x.ersetzt_durch is null)
              then 'Dienstzettel neu unterschreiben lassen' else 'Dienstzettel unterschreiben lassen' end,
         a.eintritt
  from mit_dokumenten a
  where (app.aktueller_dienstzettel(a.id)).id is null
  union all
  -- Arbeitgeber-Unterschrift fehlt
  select a.id, a.vorname, a.nachname, a.heimstandort_id, 'arbeitgeber', 'Arbeitgeber-Unterschrift fehlt', a.eintritt
  from aktiv a
  join public.dokument x on x.dienstverhaeltnis_id = a.id and x.typ = 'dienstzettel' and x.status = 'unterschrieben'
    and x.ersetzt_durch is null and x.neu_angefordert_am is null
  where app.darf_arbeitgeber_unterschreiben()
  union all
  -- Fertigen Dienstzettel an den Lohnverrechner übermitteln
  select a.id, a.vorname, a.nachname, a.heimstandort_id, 'uebermittlung', 'Dienstzettel an Lohnverrechner übermitteln', a.eintritt
  from aktiv a
  join public.dokument x on x.dienstverhaeltnis_id = a.id and x.typ = 'dienstzettel' and x.status = 'abgeschlossen'
    and x.ersetzt_durch is null and x.neu_angefordert_am is null and x.uebermittelt_am is null
  where app.ist_buero()
  union all
  -- Dringende Anmeldung, noch keine Anmeldebestätigung
  select a.id, a.vorname, a.nachname, a.heimstandort_id, 'dringend', 'Dringende Anmeldung: ' || a.dringend_grund, a.eintritt
  from aktiv a
  where app.ist_buero() and a.dringend_grund is not null and not app.angemeldet(a.id)
  union all
  -- Austritt / nicht angetreten bestätigen (Büro)
  select d.id, ma.vorname, ma.nachname, d.heimstandort_id, 'austritt_bestaetigen',
         case m.art when 'austritt' then 'Austritt bestätigen' else 'Nicht angetreten bestätigen' end,
         coalesce(m.letzter_arbeitstag, d.eintritt)
  from public.austritt_meldung m
  join public.dienstverhaeltnis d on d.id = m.dienstverhaeltnis_id
  join public.mitarbeiter ma on ma.id = d.mitarbeiter_id
  where m.organisation_id = app.organisation_id() and app.ist_buero()
    and m.ersetzt_durch is null and m.bestaetigt_am is null and not m.zurueckgenommen
  union all
  -- Abmeldung übermitteln bzw. Bestätigung hochladen, Storno ausständig (Büro, auch nach dem letzten Arbeitstag)
  select d.id, ma.vorname, ma.nachname, d.heimstandort_id,
         case s.status when 'austritt_bestaetigt' then 'abmeldung' else 'storno' end,
         case when s.status = 'storno_ausstaendig' then 'Storno ausständig'
              when exists (select 1 from public.dokument x where x.austritt_meldung_id = (app.letzte_meldung(d.id)).id
                           and x.uebermittelt_am is not null)
                then 'Abmeldebestätigung hochladen (Frist ' || to_char(d.austritt + o.abmeldefrist_tage, 'DD.MM.YYYY') || ')'
              else 'Abmeldung übermitteln bis ' || to_char(d.austritt + o.abmeldefrist_tage, 'DD.MM.YYYY') end,
         case when s.status = 'austritt_bestaetigt' then d.austritt + o.abmeldefrist_tage end
  from public.dienstverhaeltnis d
  join public.mitarbeiter ma on ma.id = d.mitarbeiter_id
  join public.organisation o on o.id = d.organisation_id
  cross join lateral (select app.dv_status(d.id) as status) s
  where d.organisation_id = app.organisation_id() and app.ist_buero()
    and s.status in ('austritt_bestaetigt', 'storno_ausstaendig')
  union all
  -- Abschrift der Abmeldung aushändigen (Büro)
  select d.id, ma.vorname, ma.nachname, d.heimstandort_id, 'abschrift', 'Abschrift der Abmeldung aushändigen', d.austritt
  from public.dokument x
  join public.dienstverhaeltnis d on d.id = x.dienstverhaeltnis_id
  join public.mitarbeiter ma on ma.id = d.mitarbeiter_id
  where x.organisation_id = app.organisation_id() and app.ist_buero()
    and x.kategorie = 'abmeldung' and x.datei_pfad is not null and x.ersetzt_durch is null and x.ausgehaendigt_am is null
    and x.typ not in ('austrittsmeldung', 'stornomeldung', 'korrekturmeldung')
$$;

revoke execute on function app.letzte_meldung(uuid), app.meldung_art(public.austritt_meldung) from public, anon, authenticated;
revoke execute on function public.uebermittlung_offen(), public.uebermittlung_vermerken(uuid[]), public.abmeldung_aushaendigen(uuid, text)
  from public, anon;
grant execute on function public.uebermittlung_offen(), public.uebermittlung_vermerken(uuid[]), public.abmeldung_aushaendigen(uuid, text)
  to authenticated;
