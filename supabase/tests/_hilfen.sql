-- Testhilfen (nur für Datenbank-Tests). Einmal mit execute_sql einspielen; kann
-- jederzeit erneut eingespielt werden. Benutzer anlegen darf nur der Betreiber (postgres).
-- Die Tests selbst laufen in einer Transaktion und enden mit rollback.
create schema if not exists testhilfe;
revoke all on schema testhilfe from public, anon;
grant usage on schema testhilfe to authenticated;

-- Als angemeldete Person weiterarbeiten (wie ein Aufruf aus der App)
create or replace function testhilfe.als(a_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- Zurück zum Betreiber
create or replace function testhilfe.zurueck() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Führt SQL aus und scheitert, wenn KEIN Fehler mit diesem Textteil kommt
create or replace function testhilfe.erwarte_fehler(a_sql text, a_text text) returns void language plpgsql as $$
begin
  begin
    execute a_sql;
  exception when others then
    if position(a_text in sqlerrm) > 0 then return; end if;
    raise exception 'FEHLER: erwartet "%", bekommen "%" bei: %', a_text, sqlerrm, a_sql;
  end;
  raise exception 'FEHLER: erwartet "%", aber kein Fehler bei: %', a_text, a_sql;
end $$;

-- Wirft, wenn die Bedingung nicht stimmt
create or replace function testhilfe.pruefe(a_ok boolean, a_was text) returns void language plpgsql as $$
begin
  if a_ok is not true then raise exception 'FEHLER: %', a_was; end if;
end $$;

-- Legt in der laufenden Transaktion eine Person mit Rolle (und Zuständigkeiten) in der Demo-Firma an
create or replace function testhilfe.benutzer(a_rolle text, a_standorte uuid[] default '{}')
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); s uuid;
begin
  insert into auth.users (id, email, aud, role) values (v, a_rolle || '-' || left(v::text, 8) || '@test.invalid', 'authenticated', 'authenticated');
  insert into public.profil (user_id, organisation_id, rolle)
  values (v, 'de000000-0000-0000-0000-000000000001', a_rolle);
  foreach s in array a_standorte loop
    insert into public.zustaendigkeit (organisation_id, user_id, standort_id)
    values ('de000000-0000-0000-0000-000000000001', v, s);
  end loop;
  return v;
end $$;

-- Legt als Personalbüro einen Mitarbeiter per Dienstzettel an (teilzeit 20 h, 5 Tage, 1000 €, ab heute)
create or replace function testhilfe.mitarbeiter_anlegen(a_hr uuid, a_standort uuid, a_funktion uuid,
  a_nachreichen boolean default false) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform testhilfe.als(a_hr);
  v := public.dienstzettel_erfassen(
    p_standort_id => a_standort, p_funktion_id => a_funktion,
    p_vorname => 'Test', p_nachname => 'Person', p_eintritt => current_date,
    p_beschaeftigungsart => 'teilzeit', p_wochenstunden => 20, p_arbeitstage_woche => 5, p_netto => 1000,
    p_anrede => 'Frau', p_geburtsdatum => date '1990-01-01', p_strasse => 'Testgasse 1', p_plz => '8010',
    p_ort => 'Graz', p_telefon => '+43 660 1234567', p_email => 'test@example.com',
    p_staatsangehoerigkeit => 'Österreich', p_iban => 'AT611904300234573201',
    p_sv_nummer => case when a_nachreichen then null else '1238010190' end,
    p_sv_nummer_nachreichen => a_nachreichen);
  perform testhilfe.zurueck();
  return v;
end $$;

revoke all on all functions in schema testhilfe from public, anon, authenticated;
grant execute on function testhilfe.als(uuid), testhilfe.zurueck(), testhilfe.erwarte_fehler(text, text),
  testhilfe.pruefe(boolean, text) to authenticated;
