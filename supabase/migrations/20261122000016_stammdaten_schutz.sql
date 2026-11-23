-- Korrektur zu 015: Eine Trigger-Funktion für zwei Tabellen scheitert, weil Postgres die Felder
-- der jeweils anderen Tabelle nicht kennt. Darum je Tabelle eine eigene Funktion.
drop trigger stammdaten_schuetzen on public.mitarbeiter;
drop trigger stammdaten_schuetzen on public.mitarbeiter_sensibel;
drop function app.stammdaten_schuetzen();

create or replace function app.stammdaten_freigegeben() returns boolean
language sql stable set search_path = '' as $$
  select (select auth.uid()) is null or coalesce(current_setting('app.stammdaten_freigabe', true), '') = 'an'
$$;

create or replace function app.mitarbeiter_schuetzen() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not app.stammdaten_freigegeben() and (
       new.anrede is distinct from old.anrede or new.vorname is distinct from old.vorname
    or new.nachname is distinct from old.nachname or new.geburtsdatum is distinct from old.geburtsdatum
    or new.strasse is distinct from old.strasse or new.plz is distinct from old.plz or new.ort is distinct from old.ort
    or new.telefon is distinct from old.telefon or new.email is distinct from old.email) then
    raise exception 'Stammdaten ändern nur über „Änderung eintragen“ in der Personalakte.';
  end if;
  return new;
end $$;

create or replace function app.sensibel_schuetzen() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not app.stammdaten_freigegeben() and (
       new.sv_nummer is distinct from old.sv_nummer or new.iban is distinct from old.iban
    or new.bic is distinct from old.bic or new.staatsangehoerigkeit is distinct from old.staatsangehoerigkeit
    or new.sv_nummer_nachreichen is distinct from old.sv_nummer_nachreichen) then
    raise exception 'Stammdaten ändern nur über „Änderung eintragen“ in der Personalakte.';
  end if;
  return new;
end $$;
create trigger stammdaten_schuetzen before update on public.mitarbeiter
  for each row execute function app.mitarbeiter_schuetzen();
create trigger stammdaten_schuetzen before update on public.mitarbeiter_sensibel
  for each row execute function app.sensibel_schuetzen();

revoke execute on function app.stammdaten_freigegeben(), app.mitarbeiter_schuetzen(), app.sensibel_schuetzen()
  from public, anon, authenticated;
