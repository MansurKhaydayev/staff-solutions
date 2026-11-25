-- Startseite: Recht „Analyse herunterladen“ und Protokoll jedes Downloads.
-- Wunsch Mansur (25.11.2026): Die gesamte Analyse dürfen nur Admin und Geschäftsführung herunterladen.
-- Die Geschäftsführung muss das Recht jeder Rolle entziehen können, auch dem Admin.
-- Entscheidung Mansur (25.11.2026): Auch der Admin darf das Recht vergeben (Option „Admin ändert auch“).
-- Deshalb gibt es zwei Spalten:
--   darf_analyse_export     wer herunterladen darf
--   vergibt_analyse_export  wer darf_analyse_export ändern darf (nur über public.analyse_recht_setzen)
-- vergibt_analyse_export selbst lässt sich in der App nicht ändern (nur der Betreiber per SQL).

alter table public.rollen_recht add column darf_analyse_export boolean not null default false;
alter table public.rollen_recht add column vergibt_analyse_export boolean not null default false;

-- Bestehende Firmen: herunterladen und vergeben wie bisher die Arbeitgeber-Unterschrift (Admin, GF)
-- (mit where, sonst hält Supabase die Anweisung für gefährlich und fragt nach)
update public.rollen_recht set darf_analyse_export = true, vergibt_analyse_export = true
  where darf_arbeitgeber_unterschreiben;

-- Neue Firmen bekommen dieselbe Voreinstellung
create or replace function app.standard_rechte(org uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.rollen_recht (organisation_id, rolle, bezeichnung, sieht_kontakt, sieht_personendaten,
    sieht_entgelt, sieht_lohnverrechnung, sieht_dokumente, reichweite, darf_anlegen, darf_verwalten,
    darf_arbeitgeber_unterschreiben, darf_analyse_export, vergibt_analyse_export)
  values
    (org, 'admin',              'Admin',             true,  true,  true,  true,  true,  'alle',       true,  true,  true,  true,  true),
    (org, 'geschaeftsfuehrung', 'Geschäftsführung',  true,  true,  true,  true,  true,  'alle',       true,  false, true,  true,  true),
    (org, 'hr',                 'Personalbüro',      true,  true,  true,  true,  true,  'alle',       true,  false, false, false, false),
    (org, 'verwaltung',         'Verwaltung',        true,  false, false, false, false, 'alle',       false, false, false, false, false),
    (org, 'buchhaltung',        'Buchhaltung',       true,  true,  true,  true,  false, 'alle',       false, false, false, false, false),
    (org, 'regionalleitung',    'Regionalleitung',   true,  true,  true,  false, true,  'zugeordnet', true,  false, false, false, false),
    (org, 'studioleitung',      'Studioleitung',     true,  false, false, false, true,  'zugeordnet', true,  false, false, false, false),
    (org, 'mitarbeiter',        'Mitarbeiter',       false, false, false, false, false, 'eigene',     false, false, false, false, false)
  on conflict (organisation_id, rolle) do nothing
$$;

-- Die beiden Spalten sind gegen direktes Ändern gesperrt (auch für wer „Einstellungen verwalten“ darf).
-- Nur public.analyse_recht_setzen öffnet die Sperre für einen einzelnen Aufruf.
create or replace function app.analyse_recht_schuetzen() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.darf_analyse_export is distinct from old.darf_analyse_export
      and coalesce(current_setting('app.analyse_recht_setzen', true), '') <> 'ja')
     or (new.vergibt_analyse_export is distinct from old.vergibt_analyse_export and (select auth.uid()) is not null) then
    raise exception 'Das Recht „Analyse herunterladen“ können nur Rollen ändern, die es vergeben dürfen.';
  end if;
  return new;
end $$;

create trigger analyse_recht_schuetzen before update on public.rollen_recht
  for each row execute function app.analyse_recht_schuetzen();

create or replace function app.darf_analyse_export() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select r.darf_analyse_export from public.profil p
    join public.rollen_recht r on r.organisation_id = p.organisation_id and r.rolle = p.rolle
    where p.user_id = (select auth.uid())), false)
$$;

create or replace function app.vergibt_analyse_export() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select r.vergibt_analyse_export from public.profil p
    join public.rollen_recht r on r.organisation_id = p.organisation_id and r.rolle = p.rolle
    where p.user_id = (select auth.uid())), false)
$$;

-- Recht einer Rolle setzen oder entziehen (nur wer vergeben darf), mit Protokoll
create or replace function public.analyse_recht_setzen(p_rolle text, p_darf boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_alt boolean;
begin
  if not app.vergibt_analyse_export() then
    raise exception 'Das Recht „Analyse herunterladen“ können nur Rollen ändern, die es vergeben dürfen.';
  end if;
  if p_darf is null then raise exception 'Bitte ja oder nein angeben.'; end if;
  select darf_analyse_export into v_alt from public.rollen_recht
    where organisation_id = app.organisation_id() and rolle = p_rolle for update;
  if not found then raise exception 'Diese Rolle gibt es nicht.'; end if;
  if v_alt = p_darf then return; end if;
  perform set_config('app.analyse_recht_setzen', 'ja', true);
  update public.rollen_recht set darf_analyse_export = p_darf
    where organisation_id = app.organisation_id() and rolle = p_rolle;
  perform set_config('app.analyse_recht_setzen', '', true);
  insert into public.audit_log (organisation_id, user_id, tabelle, datensatz_id, aktion, alt, neu)
  values (app.organisation_id(), (select auth.uid()), 'rollen_recht', null, 'analyse_recht',
          jsonb_build_object('rolle', p_rolle, 'darf_analyse_export', v_alt),
          jsonb_build_object('rolle', p_rolle, 'darf_analyse_export', p_darf));
end $$;

-- Jeder Download wird vor dem Erzeugen vermerkt. Ohne Recht: Fehler, kein PDF.
-- Gibt die Nummer des Protokolleintrags zurück (steht im PDF).
create or replace function public.analyse_export_vermerken(p_jahr int, p_monat int, p_standort uuid default null)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if not app.darf_analyse_export() then
    raise exception 'Mit deinem Zugang kannst du die Analyse nicht herunterladen.';
  end if;
  if p_jahr is null or p_jahr < 2000 or p_jahr > 2100 or p_monat is null or p_monat not between 1 and 12 then
    raise exception 'Bitte einen gültigen Monat wählen.';
  end if;
  if p_standort is not null and not exists (
      select 1 from public.standort s where s.id = p_standort and s.organisation_id = app.organisation_id()) then
    raise exception 'Diesen Arbeitsort gibt es nicht.';
  end if;
  insert into public.audit_log (organisation_id, user_id, tabelle, datensatz_id, aktion, neu)
  values (app.organisation_id(), (select auth.uid()), 'analyse', p_standort, 'export',
          jsonb_build_object('jahr', p_jahr, 'monat', p_monat, 'standort_id', p_standort))
  returning id into v_id;
  return v_id;
end $$;

-- Ohne „revoke“: Supabase fragt bei solchen Anweisungen nach einer Bestätigung, die oft abbricht.
-- Die Funktionen prüfen das Recht selbst (ohne Anmeldung gibt es keine Rolle, also kein Recht).
grant execute on function app.darf_analyse_export(), app.vergibt_analyse_export(),
  public.analyse_recht_setzen(text, boolean), public.analyse_export_vermerken(int, int, uuid) to authenticated;
