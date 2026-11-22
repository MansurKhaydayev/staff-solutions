-- Onboarding-Unterlagen: Liste je Firma (in den Einstellungen pflegbar), Stand je Dienstverhältnis.
-- Lehnt jemand eine Pflichtunterlage ab, entsteht eine Klärung mit der Geschäftsführung.

create table public.onboarding_unterlage (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisation(id),
  bezeichnung      text not null check (trim(bezeichnung) <> ''),
  reihenfolge      int not null default 0,
  pflicht          boolean not null default false,
  gilt_fuer        text not null default 'beide' check (gilt_fuer in ('studio', 'buero', 'beide')),
  aktiv            boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (id, organisation_id)
);
create index on public.onboarding_unterlage (organisation_id, reihenfolge);

alter table public.onboarding_unterlage enable row level security;
create policy alle_lesen on public.onboarding_unterlage for select to authenticated
  using (organisation_id = (select app.organisation_id()));
create policy buero_anlegen on public.onboarding_unterlage for insert to authenticated
  with check (organisation_id = (select app.organisation_id()) and (select app.ist_buero()));
create policy buero_aendern on public.onboarding_unterlage for update to authenticated
  using (organisation_id = (select app.organisation_id()) and (select app.ist_buero()))
  with check (organisation_id = (select app.organisation_id()) and (select app.ist_buero()));
-- Kein Löschen: nicht mehr benötigte Unterlagen werden deaktiviert.
create trigger loeschen_verboten before delete on public.onboarding_unterlage
  for each row execute function app.loeschen_verboten();
create trigger audit_onboarding_unterlage after insert or update or delete on public.onboarding_unterlage
  for each row execute function app.audit();

alter table public.dokument add foreign key (onboarding_unterlage_id, organisation_id)
  references public.onboarding_unterlage (id, organisation_id);
create index on public.dokument (onboarding_unterlage_id, organisation_id);

create table public.onboarding_klaerung (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisation(id),
  dienstverhaeltnis_id    uuid not null,
  onboarding_unterlage_id uuid not null,
  dokument_id             uuid,
  erstellt_am             timestamptz not null default now(),
  geschlossen_am          timestamptz,
  geschlossen_von         uuid references auth.users(id),
  vermerk                 text,
  foreign key (dienstverhaeltnis_id, organisation_id) references public.dienstverhaeltnis (id, organisation_id),
  foreign key (onboarding_unterlage_id, organisation_id) references public.onboarding_unterlage (id, organisation_id),
  foreign key (dokument_id, organisation_id) references public.dokument (id, organisation_id)
);
create unique index onboarding_klaerung_offen on public.onboarding_klaerung (dienstverhaeltnis_id, onboarding_unterlage_id)
  where geschlossen_am is null;
create index on public.onboarding_klaerung (dienstverhaeltnis_id, organisation_id);
create index on public.onboarding_klaerung (onboarding_unterlage_id, organisation_id);
create index on public.onboarding_klaerung (dokument_id, organisation_id);
create index on public.onboarding_klaerung (organisation_id);
create index on public.onboarding_klaerung (geschlossen_von);

alter table public.onboarding_klaerung enable row level security;
create policy nach_recht on public.onboarding_klaerung for select to authenticated
  using (organisation_id = (select app.organisation_id())
         and app.sieht('dokumente', app.standort_von(dienstverhaeltnis_id)));
create trigger loeschen_verboten before delete on public.onboarding_klaerung
  for each row execute function app.loeschen_verboten();
create trigger audit_onboarding_klaerung after insert or update or delete on public.onboarding_klaerung
  for each row execute function app.audit();

-- Nach jeder Ablage: abgelehnte Pflichtunterlage -> offene Klärung
create or replace function app.onboarding_nach_ablage(p_dokument uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_dok public.dokument%rowtype;
begin
  select * into v_dok from public.dokument where id = p_dokument;
  if v_dok.kategorie = 'onboarding' and v_dok.onboarding_ergebnis = 'abgelehnt'
     and exists (select 1 from public.onboarding_unterlage u where u.id = v_dok.onboarding_unterlage_id and u.pflicht) then
    insert into public.onboarding_klaerung (organisation_id, dienstverhaeltnis_id, onboarding_unterlage_id, dokument_id)
    values (v_dok.organisation_id, v_dok.dienstverhaeltnis_id, v_dok.onboarding_unterlage_id, v_dok.id)
    on conflict (dienstverhaeltnis_id, onboarding_unterlage_id) where geschlossen_am is null do nothing;
  end if;
end $$;

-- Checkliste eines Dienstverhältnisses
create or replace function public.onboarding_stand(p_dienstverhaeltnis_id uuid)
returns table (unterlage_id uuid, bezeichnung text, pflicht boolean, reihenfolge int, status text, dokument_id uuid)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_dv public.dienstverhaeltnis%rowtype;
  v_art text;
begin
  select * into v_dv from public.dienstverhaeltnis where id = p_dienstverhaeltnis_id and organisation_id = app.organisation_id();
  if v_dv.id is null or not app.sieht('dokumente', v_dv.heimstandort_id) then
    raise exception 'Keine Berechtigung für diese Unterlagen.';
  end if;
  select s.art into v_art from public.standort s where s.id = v_dv.heimstandort_id;

  return query
  select u.id, u.bezeichnung, u.pflicht, u.reihenfolge,
    case
      when d.id is null then 'fehlt'
      when d.onboarding_ergebnis = 'unterschrieben' then 'erledigt'
      when not u.pflicht then 'abgelehnt'
      when exists (select 1 from public.onboarding_klaerung k where k.dienstverhaeltnis_id = v_dv.id
                   and k.onboarding_unterlage_id = u.id and k.geschlossen_am is null) then 'klaerung'
      when exists (select 1 from public.onboarding_klaerung k where k.dienstverhaeltnis_id = v_dv.id
                   and k.onboarding_unterlage_id = u.id) then 'geklaert'
      else 'klaerung' end,
    d.id
  from public.onboarding_unterlage u
  left join lateral (
    select x.* from public.dokument x
    where x.dienstverhaeltnis_id = v_dv.id and x.kategorie = 'onboarding' and x.onboarding_unterlage_id = u.id
      and x.ersetzt_durch is null and (x.datei_pfad is not null or x.onboarding_ergebnis = 'abgelehnt')
    order by coalesce(x.hochgeladen_am, x.created_at) desc
    limit 1) d on true
  where u.organisation_id = v_dv.organisation_id and u.aktiv and (u.gilt_fuer = 'beide' or u.gilt_fuer = v_art)
  order by u.reihenfolge, u.bezeichnung;
end $$;

-- Ablehnung ohne Datei (nur Vermerk durch das Büro)
create or replace function public.onboarding_vermerken(p_dienstverhaeltnis_id uuid, p_unterlage_id uuid, p_vermerk text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := app.organisation_id();
  v_u   public.onboarding_unterlage%rowtype;
  v_dok uuid;
begin
  if not app.ist_buero() then raise exception 'Eine Ablehnung ohne Unterlage vermerkt das Personalbüro.'; end if;
  if coalesce(trim(p_vermerk), '') = '' then raise exception 'Bitte einen Vermerk angeben.'; end if;
  select * into v_u from public.onboarding_unterlage where id = p_unterlage_id and organisation_id = v_org;
  if v_u.id is null then raise exception 'Diese Unterlage wurde nicht gefunden.'; end if;
  if not exists (select 1 from public.dienstverhaeltnis where id = p_dienstverhaeltnis_id and organisation_id = v_org) then
    raise exception 'Diese Person wurde nicht gefunden.';
  end if;
  insert into public.dokument (organisation_id, dienstverhaeltnis_id, typ, kategorie, bezeichnung,
    onboarding_unterlage_id, onboarding_ergebnis, status)
  values (v_org, p_dienstverhaeltnis_id, 'onboarding', 'onboarding', v_u.bezeichnung || ' – abgelehnt: ' || trim(p_vermerk),
    v_u.id, 'abgelehnt', 'abgelehnt')
  returning id into v_dok;
  perform app.onboarding_nach_ablage(v_dok);
  return v_dok;
end $$;

create or replace function public.klaerung_schliessen(p_klaerung_id uuid, p_vermerk text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.ist_buero() then raise exception 'Klärungen schließt das Personalbüro.'; end if;
  if coalesce(trim(p_vermerk), '') = '' then raise exception 'Bitte einen Vermerk angeben (Entscheidung der Geschäftsführung).'; end if;
  update public.onboarding_klaerung set geschlossen_am = now(), geschlossen_von = auth.uid(), vermerk = trim(p_vermerk)
  where id = p_klaerung_id and organisation_id = app.organisation_id() and geschlossen_am is null;
  if not found then raise exception 'Diese Klärung ist nicht offen.'; end if;
end $$;

revoke execute on function public.onboarding_stand(uuid), public.onboarding_vermerken(uuid, uuid, text),
  public.klaerung_schliessen(uuid, text) from public, anon;
grant execute on function public.onboarding_stand(uuid), public.onboarding_vermerken(uuid, uuid, text),
  public.klaerung_schliessen(uuid, text) to authenticated;
revoke execute on function app.onboarding_nach_ablage(uuid) from public, anon, authenticated;
