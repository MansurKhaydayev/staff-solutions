-- Vertragsstand: jede Arbeitszeit gilt ab einem Datum. Der erste Stand kommt aus dem
-- Dienstzettel, jede Stundenanpassung ist ein neuer Stand. Die Spalten im Dienstverhältnis
-- bleiben als "Stand bei Eintritt" erhalten und ändern sich nicht mehr.

create table public.vertragsstand (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisation(id),
  dienstverhaeltnis_id uuid not null,
  gueltig_ab           date not null,
  beschaeftigungsart   text not null check (beschaeftigungsart in ('vollzeit', 'teilzeit', 'geringfuegig')),
  wochenstunden        numeric(4,1) not null check (wochenstunden > 0 and wochenstunden <= 60),
  arbeitstage_woche    int check (arbeitstage_woche between 1 and 6),
  storniert_am         timestamptz,
  storniert_von        uuid references auth.users(id),
  storno_grund         text,
  created_at           timestamptz not null default now(),
  created_by           uuid references auth.users(id) default auth.uid(),
  unique (id, organisation_id),
  check ((storniert_am is null) = (storno_grund is null)),
  foreign key (dienstverhaeltnis_id, organisation_id) references public.dienstverhaeltnis (id, organisation_id)
);
create unique index vertragsstand_ein_stand_je_tag on public.vertragsstand (dienstverhaeltnis_id, gueltig_ab)
  where storniert_am is null;
create index on public.vertragsstand (dienstverhaeltnis_id, organisation_id);
create index on public.vertragsstand (organisation_id);
create index on public.vertragsstand (storniert_von);
create index on public.vertragsstand (created_by);

alter table public.vertragsstand enable row level security;
create policy nach_recht on public.vertragsstand for select to authenticated
  using (organisation_id = (select app.organisation_id())
         and app.sieht('personendaten', app.standort_von(dienstverhaeltnis_id)));
-- Keine Schreibregeln: Stände entstehen nur über Funktionen (stunden_anpassen).

create trigger audit_vertragsstand after insert or update or delete on public.vertragsstand
  for each row execute function app.audit();

-- Entgelt gehört zu einem Stand und kann storniert werden
alter table public.entgelt add column vertragsstand_id uuid;
alter table public.entgelt add column storniert_am timestamptz;
alter table public.entgelt add foreign key (vertragsstand_id, organisation_id)
  references public.vertragsstand (id, organisation_id);
create index on public.entgelt (vertragsstand_id, organisation_id);
alter table public.entgelt drop constraint entgelt_dienstverhaeltnis_id_gueltig_ab_key;
create unique index entgelt_ein_betrag_je_tag on public.entgelt (dienstverhaeltnis_id, gueltig_ab)
  where storniert_am is null;

-- Aktueller Stand an einem Tag (die einzige Stelle, die das ausrechnet)
create or replace function app.stand_am(p_dv uuid, p_tag date) returns public.vertragsstand
language sql stable security definer set search_path = '' as $$
  select v.* from public.vertragsstand v
  where v.dienstverhaeltnis_id = p_dv and v.storniert_am is null and v.gueltig_ab <= p_tag
  order by v.gueltig_ab desc
  limit 1
$$;

-- Erster Stand beim Anlegen eines Dienstverhältnisses
create or replace function app.erster_stand() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.vertragsstand (organisation_id, dienstverhaeltnis_id, gueltig_ab,
                                    beschaeftigungsart, wochenstunden, arbeitstage_woche)
  values (new.organisation_id, new.id, new.eintritt, new.beschaeftigungsart, new.wochenstunden, new.arbeitstage_woche);
  return null;
end $$;
create trigger erster_stand after insert on public.dienstverhaeltnis
  for each row execute function app.erster_stand();

-- Entgelt ohne Stand: an den Stand mit demselben Datum hängen
create or replace function app.entgelt_stand_setzen() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.vertragsstand_id is null then
    select v.id into new.vertragsstand_id from public.vertragsstand v
    where v.dienstverhaeltnis_id = new.dienstverhaeltnis_id and v.gueltig_ab = new.gueltig_ab
      and v.storniert_am is null;
  end if;
  return new;
end $$;
create trigger entgelt_stand_setzen before insert on public.entgelt
  for each row execute function app.entgelt_stand_setzen();

-- Nachtrag für bestehende Dienstverhältnisse
insert into public.vertragsstand (organisation_id, dienstverhaeltnis_id, gueltig_ab,
                                  beschaeftigungsart, wochenstunden, arbeitstage_woche, created_by)
select d.organisation_id, d.id, d.eintritt, d.beschaeftigungsart, d.wochenstunden, d.arbeitstage_woche, null
from public.dienstverhaeltnis d
where not exists (select 1 from public.vertragsstand v where v.dienstverhaeltnis_id = d.id);
update public.entgelt e set vertragsstand_id = v.id
from public.vertragsstand v
where e.vertragsstand_id is null and v.dienstverhaeltnis_id = e.dienstverhaeltnis_id and v.gueltig_ab = e.gueltig_ab;

-- Stunden im Dienstverhältnis nicht mehr direkt ändern (nur der Betreiber per SQL)
create or replace function app.dienstverhaeltnis_schuetzen() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and (
       new.beschaeftigungsart is distinct from old.beschaeftigungsart
    or new.wochenstunden is distinct from old.wochenstunden
    or new.arbeitstage_woche is distinct from old.arbeitstage_woche
    or new.eintritt is distinct from old.eintritt) then
    raise exception 'Stunden ändern nur über eine Stundenanpassung in der Personalakte.';
  end if;
  return new;
end $$;
create trigger dienstverhaeltnis_schuetzen before update on public.dienstverhaeltnis
  for each row execute function app.dienstverhaeltnis_schuetzen();

-- Nichts in der Personalakte wird gelöscht (nur der Betreiber per SQL)
create or replace function app.loeschen_verboten() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null then
    raise exception 'Einträge in der Personalakte werden nie gelöscht.';
  end if;
  return old;
end $$;
create trigger loeschen_verboten before delete on public.vertragsstand
  for each row execute function app.loeschen_verboten();
create trigger loeschen_verboten before delete on public.entgelt
  for each row execute function app.loeschen_verboten();
create trigger loeschen_verboten before delete on public.dokument
  for each row execute function app.loeschen_verboten();

revoke execute on function app.stand_am(uuid, date) from public, anon;
grant execute on function app.stand_am(uuid, date) to authenticated;
revoke execute on function app.erster_stand(), app.entgelt_stand_setzen(), app.dienstverhaeltnis_schuetzen(),
  app.loeschen_verboten() from public, anon, authenticated;

-- Mitarbeiterverzeichnis: Stunden und Beschäftigungsart aus dem aktuellen Stand
create or replace function public.mitarbeiter_verzeichnis()
returns table (
  dienstverhaeltnis_id uuid,
  mitarbeiter_id       uuid,
  vorname              text,
  nachname             text,
  funktion_id          uuid,
  standort_id          uuid,
  eintritt             date,
  austritt             date,
  erfasst_am           timestamptz,
  telefon              text,
  email                text,
  beschaeftigungsart   text,
  wochenstunden        numeric,
  befristet_bis        date
)
language sql stable security definer set search_path = '' as $$
  with ich as (
    select p.user_id, p.organisation_id, p.mitarbeiter_id,
           r.sieht_kontakt, r.sieht_personendaten, r.reichweite
    from public.profil p
    join public.rollen_recht r on r.organisation_id = p.organisation_id and r.rolle = p.rolle
    where p.user_id = (select auth.uid())
  )
  select d.id, m.id, m.vorname, m.nachname, d.funktion_id, d.heimstandort_id,
         d.eintritt, d.austritt, d.created_at,
         case when ich.sieht_kontakt then m.telefon end,
         case when ich.sieht_kontakt then m.email end,
         case when ich.sieht_personendaten then coalesce(s.beschaeftigungsart, d.beschaeftigungsart) end,
         case when ich.sieht_personendaten then coalesce(s.wochenstunden, d.wochenstunden) end,
         case when ich.sieht_personendaten then d.befristet_bis end
  from ich
  join public.dienstverhaeltnis d on d.organisation_id = ich.organisation_id
  join public.mitarbeiter m on m.id = d.mitarbeiter_id
  left join lateral app.stand_am(d.id, greatest(current_date, d.eintritt)) s on true
  where case ich.reichweite
          when 'alle' then true
          when 'zugeordnet' then exists (select 1 from public.zustaendigkeit z
                                         where z.user_id = ich.user_id and z.standort_id = d.heimstandort_id)
          else m.id = ich.mitarbeiter_id
        end
$$;
