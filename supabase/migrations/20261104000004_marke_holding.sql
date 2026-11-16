-- Staff-Solutions - Migration 004: Marke und Holding-Zuordnung der GmbHs
create table public.marke (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisation(id),
  name             text not null,
  unique (organisation_id, name),
  unique (id, organisation_id)
);
create index on public.marke (organisation_id);

alter table public.gesellschaft add column marke_id uuid;
alter table public.gesellschaft add column holding_id uuid;
alter table public.gesellschaft add column ist_holding boolean not null default false;
alter table public.gesellschaft add foreign key (marke_id, organisation_id)
  references public.marke (id, organisation_id);
alter table public.gesellschaft add foreign key (holding_id, organisation_id)
  references public.gesellschaft (id, organisation_id);
alter table public.gesellschaft add constraint gesellschaft_holding_check
  check (holding_id is null or holding_id <> id);
create index on public.gesellschaft (marke_id, organisation_id);
create index on public.gesellschaft (holding_id, organisation_id);

alter table public.marke enable row level security;
revoke all on public.marke from anon;
grant select, insert, update, delete on public.marke to authenticated;
create policy buero_vollzugriff on public.marke for all to authenticated
  using (organisation_id = (select app.organisation_id()) and (select app.ist_buero()))
  with check (organisation_id = (select app.organisation_id()) and (select app.ist_buero()));
create policy alle_lesen on public.marke for select to authenticated
  using (organisation_id = (select app.organisation_id()));
