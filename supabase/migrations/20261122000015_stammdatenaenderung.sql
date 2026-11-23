-- Änderungen an Stammdaten (Name, Adresse, Kontakt, Bank, Versicherungsnummer …) werden mit
-- altem und neuem Wert, Grund und Nachweis gespeichert. Direktes Überschreiben ist gesperrt.

create table public.stammdaten_aenderung (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisation(id),
  mitarbeiter_id   uuid not null,
  feld             text not null check (feld in ('anrede', 'vorname', 'nachname', 'geburtsdatum', 'strasse', 'plz',
                     'ort', 'telefon', 'email', 'sv_nummer', 'iban', 'bic', 'staatsangehoerigkeit')),
  stufe            text not null check (stufe in ('personendaten', 'lohnverrechnung')),
  alt              text,
  neu              text,
  gueltig_ab       date not null,
  grund            text not null,
  ist_ergaenzung   boolean not null default false,
  dokument_id      uuid,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id) default auth.uid(),
  foreign key (mitarbeiter_id, organisation_id) references public.mitarbeiter (id, organisation_id),
  foreign key (dokument_id, organisation_id) references public.dokument (id, organisation_id)
);
create index on public.stammdaten_aenderung (mitarbeiter_id, organisation_id);
create index on public.stammdaten_aenderung (dokument_id, organisation_id);
create index on public.stammdaten_aenderung (organisation_id);
create index on public.stammdaten_aenderung (created_by);

alter table public.stammdaten_aenderung enable row level security;
create policy nach_recht on public.stammdaten_aenderung for select to authenticated
  using (organisation_id = (select app.organisation_id()) and app.sieht_person(stufe, mitarbeiter_id));
-- Keine Schreibregeln: Einträge entstehen nur über die Funktionen unten und bleiben unverändert.
create trigger loeschen_verboten before delete on public.stammdaten_aenderung
  for each row execute function app.loeschen_verboten();

-- Direktes Ändern der Stammdaten sperren (die Funktionen unten geben es kurz frei)
-- (Korrigiert in 016: je Tabelle eine eigene Trigger-Funktion)
create or replace function app.stammdaten_schuetzen() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or coalesce(current_setting('app.stammdaten_freigabe', true), '') = 'an' then
    return new;
  end if;
  if tg_table_name = 'mitarbeiter' and (
       new.anrede is distinct from old.anrede or new.vorname is distinct from old.vorname
    or new.nachname is distinct from old.nachname or new.geburtsdatum is distinct from old.geburtsdatum
    or new.strasse is distinct from old.strasse or new.plz is distinct from old.plz or new.ort is distinct from old.ort
    or new.telefon is distinct from old.telefon or new.email is distinct from old.email) then
    raise exception 'Stammdaten ändern nur über „Änderung eintragen“ in der Personalakte.';
  end if;
  if tg_table_name = 'mitarbeiter_sensibel' and (
       new.sv_nummer is distinct from old.sv_nummer or new.iban is distinct from old.iban
    or new.bic is distinct from old.bic or new.staatsangehoerigkeit is distinct from old.staatsangehoerigkeit
    or new.sv_nummer_nachreichen is distinct from old.sv_nummer_nachreichen) then
    raise exception 'Stammdaten ändern nur über „Änderung eintragen“ in der Personalakte.';
  end if;
  return new;
end $$;
create trigger stammdaten_schuetzen before update on public.mitarbeiter
  for each row execute function app.stammdaten_schuetzen();
create trigger stammdaten_schuetzen before update on public.mitarbeiter_sensibel
  for each row execute function app.stammdaten_schuetzen();

create or replace function public.stammdaten_aendern(
  p_mitarbeiter_id uuid,
  p_werte          jsonb,
  p_gueltig_ab     date,
  p_grund          text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org     uuid := app.organisation_id();
  v_ma      public.mitarbeiter%rowtype;
  v_sens    public.mitarbeiter_sensibel%rowtype;
  v_dv      public.dienstverhaeltnis%rowtype;
  v_feld    text;
  v_roh     text;
  v_neu     text;
  v_alt     text;
  v_stufe   text;
  v_stufen  text[] := '{}';
  v_erstes  text;
  v_alter   int;
  v_namen   jsonb := '{"anrede":"Anrede","vorname":"Vorname","nachname":"Nachname","geburtsdatum":"Geburtsdatum",
    "strasse":"Straße","plz":"PLZ","ort":"Ort","telefon":"Telefonnummer","email":"E-Mail-Adresse",
    "sv_nummer":"Versicherungsnummer","iban":"IBAN","bic":"BIC","staatsangehoerigkeit":"Staatsangehörigkeit"}';
  v_aend    jsonb := '[]';
  v_dok     uuid;
  e         jsonb;
begin
  if not app.ist_buero() then raise exception 'Änderungen an Stammdaten trägt das Personalbüro ein.'; end if;
  select * into v_ma from public.mitarbeiter where id = p_mitarbeiter_id and organisation_id = v_org;
  if v_ma.id is null then raise exception 'Diese Person wurde nicht gefunden.'; end if;
  select * into v_sens from public.mitarbeiter_sensibel where mitarbeiter_id = v_ma.id;
  select * into v_dv from public.dienstverhaeltnis where mitarbeiter_id = v_ma.id order by eintritt desc limit 1;

  if coalesce(trim(p_grund), '') = '' then raise exception 'Bitte einen Grund angeben.'; end if;
  if p_gueltig_ab is null then raise exception 'Bitte angeben, ab wann die Änderung gilt.'; end if;
  if p_gueltig_ab < current_date - 90 then raise exception 'Die Änderung liegt mehr als 3 Monate zurück.'; end if;
  if p_gueltig_ab > current_date then
    raise exception 'Eine Änderung kann nicht in der Zukunft liegen. Bitte eintragen, sobald sie gilt.';
  end if;
  if p_werte is null or jsonb_typeof(p_werte) <> 'object' or p_werte = '{}' then
    raise exception 'Bitte mindestens ein Feld ändern.';
  end if;

  for v_feld, v_roh in select key, value from jsonb_each_text(p_werte) loop
    if not v_namen ? v_feld then raise exception 'Unbekanntes Feld: %', v_feld; end if;
    v_stufe := case when v_feld in ('sv_nummer', 'iban', 'bic', 'staatsangehoerigkeit') then 'lohnverrechnung' else 'personendaten' end;
    if not v_stufe = any (v_stufen) then v_stufen := v_stufen || v_stufe; end if;
    v_erstes := coalesce(v_erstes, v_feld);

    -- Schreibweise vereinheitlichen
    v_neu := case v_feld
      when 'email' then lower(trim(v_roh))
      when 'iban' then upper(replace(v_roh, ' ', ''))
      when 'bic' then nullif(upper(trim(v_roh)), '')
      when 'sv_nummer' then replace(v_roh, ' ', '')
      else trim(v_roh) end;

    -- Prüfen wie beim Dienstzettel
    if v_feld <> 'bic' and coalesce(v_neu, '') = '' then raise exception '% darf nicht leer sein.', v_namen ->> v_feld; end if;
    if v_feld = 'plz' and v_neu !~ '^[0-9]{4,5}$' then raise exception 'PLZ hat 4 oder 5 Ziffern.'; end if;
    if v_feld = 'telefon' and v_neu !~ '^\+?[0-9 /()-]{6,}$' then raise exception 'Telefonnummer ist ungültig.'; end if;
    if v_feld = 'email' and v_neu !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-Mail-Adresse ist ungültig.'; end if;
    if v_feld = 'iban' and not app.iban_gueltig(v_neu) then raise exception 'Die IBAN ist ungültig.'; end if;
    if v_feld = 'sv_nummer' then
      if v_sens.sv_nummer is null then
        raise exception 'Es ist noch keine Versicherungsnummer eingetragen. Bitte „Nummer eintragen“ verwenden.';
      end if;
      if v_neu !~ '^[0-9]{10}$' or not app.sv_nummer_gueltig(v_neu) then
        raise exception 'Die Versicherungsnummer ist ungültig (Prüfziffer stimmt nicht).';
      end if;
    end if;
    if v_feld = 'geburtsdatum' then
      begin
        v_alter := extract(year from age(v_dv.eintritt, v_neu::date));
      exception when others then
        raise exception 'Geburtsdatum ist ungültig.';
      end;
      if v_alter < 15 then raise exception 'Zum Dienstantritt wäre die Person erst % Jahre alt.', v_alter; end if;
      if v_alter > 80 then raise exception 'Geburtsdatum bitte prüfen (Alter %).', v_alter; end if;
    end if;

    v_alt := case v_feld
      when 'anrede' then v_ma.anrede when 'vorname' then v_ma.vorname when 'nachname' then v_ma.nachname
      when 'geburtsdatum' then v_ma.geburtsdatum::text when 'strasse' then v_ma.strasse when 'plz' then v_ma.plz
      when 'ort' then v_ma.ort when 'telefon' then v_ma.telefon when 'email' then v_ma.email
      when 'sv_nummer' then v_sens.sv_nummer when 'iban' then v_sens.iban when 'bic' then v_sens.bic
      when 'staatsangehoerigkeit' then v_sens.staatsangehoerigkeit end;
    if v_feld = 'geburtsdatum' then v_neu := v_neu::date::text; end if;

    if v_neu is distinct from v_alt then
      v_aend := v_aend || jsonb_build_object('feld', v_feld, 'stufe', v_stufe, 'alt', v_alt, 'neu', v_neu);
    end if;
  end loop;

  if array_length(v_stufen, 1) > 1 then
    raise exception 'Bitte Personendaten und Lohnverrechnungsdaten getrennt eintragen.';
  end if;
  if jsonb_array_length(v_aend) = 0 then raise exception '% ist unverändert.', v_namen ->> v_erstes; end if;

  insert into public.dokument (organisation_id, dienstverhaeltnis_id, typ, kategorie, bezeichnung)
  values (v_org, v_dv.id, 'sonstiges', 'nachweis_' || v_stufen[1], 'Nachweis Stammdatenänderung')
  returning id into v_dok;

  perform set_config('app.stammdaten_freigabe', 'an', true);
  for e in select * from jsonb_array_elements(v_aend) loop
    insert into public.stammdaten_aenderung (organisation_id, mitarbeiter_id, feld, stufe, alt, neu, gueltig_ab, grund, dokument_id)
    values (v_org, v_ma.id, e ->> 'feld', e ->> 'stufe', e ->> 'alt', e ->> 'neu', p_gueltig_ab, trim(p_grund), v_dok);
    case e ->> 'feld'
      when 'anrede' then update public.mitarbeiter set anrede = e ->> 'neu' where id = v_ma.id;
      when 'vorname' then update public.mitarbeiter set vorname = e ->> 'neu' where id = v_ma.id;
      when 'nachname' then update public.mitarbeiter set nachname = e ->> 'neu' where id = v_ma.id;
      when 'geburtsdatum' then update public.mitarbeiter set geburtsdatum = (e ->> 'neu')::date where id = v_ma.id;
      when 'strasse' then update public.mitarbeiter set strasse = e ->> 'neu' where id = v_ma.id;
      when 'plz' then update public.mitarbeiter set plz = e ->> 'neu' where id = v_ma.id;
      when 'ort' then update public.mitarbeiter set ort = e ->> 'neu' where id = v_ma.id;
      when 'telefon' then update public.mitarbeiter set telefon = e ->> 'neu' where id = v_ma.id;
      when 'email' then update public.mitarbeiter set email = e ->> 'neu' where id = v_ma.id;
      when 'sv_nummer' then update public.mitarbeiter_sensibel set sv_nummer = e ->> 'neu' where mitarbeiter_id = v_ma.id;
      when 'iban' then update public.mitarbeiter_sensibel set iban = e ->> 'neu' where mitarbeiter_id = v_ma.id;
      when 'bic' then update public.mitarbeiter_sensibel set bic = e ->> 'neu' where mitarbeiter_id = v_ma.id;
      when 'staatsangehoerigkeit' then update public.mitarbeiter_sensibel set staatsangehoerigkeit = e ->> 'neu' where mitarbeiter_id = v_ma.id;
    end case;
  end loop;
  perform set_config('app.stammdaten_freigabe', 'aus', true);
  return v_dok;
end $$;

create or replace function public.sv_nummer_nachtragen(p_mitarbeiter_id uuid, p_sv_nummer text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_sens public.mitarbeiter_sensibel%rowtype;
  v_nr   text := replace(coalesce(p_sv_nummer, ''), ' ', '');
begin
  if not app.ist_buero() then raise exception 'Änderungen an Stammdaten trägt das Personalbüro ein.'; end if;
  select * into v_sens from public.mitarbeiter_sensibel
  where mitarbeiter_id = p_mitarbeiter_id and organisation_id = app.organisation_id();
  if v_sens.mitarbeiter_id is null then raise exception 'Diese Person wurde nicht gefunden.'; end if;
  if v_sens.sv_nummer is not null then
    raise exception 'Die Versicherungsnummer ist schon eingetragen. Bitte über „Änderung eintragen“ ändern.';
  end if;
  if v_nr !~ '^[0-9]{10}$' or not app.sv_nummer_gueltig(v_nr) then
    raise exception 'Die Versicherungsnummer ist ungültig (Prüfziffer stimmt nicht).';
  end if;

  insert into public.stammdaten_aenderung (organisation_id, mitarbeiter_id, feld, stufe, alt, neu, gueltig_ab, grund, ist_ergaenzung)
  values (v_sens.organisation_id, v_sens.mitarbeiter_id, 'sv_nummer', 'lohnverrechnung', null, v_nr, current_date, 'Nachgereicht', true);
  perform set_config('app.stammdaten_freigabe', 'an', true);
  update public.mitarbeiter_sensibel set sv_nummer = v_nr, sv_nummer_nachreichen = false
  where mitarbeiter_id = v_sens.mitarbeiter_id;
  perform set_config('app.stammdaten_freigabe', 'aus', true);
end $$;

revoke execute on function public.stammdaten_aendern(uuid, jsonb, date, text), public.sv_nummer_nachtragen(uuid, text)
  from public, anon;
grant execute on function public.stammdaten_aendern(uuid, jsonb, date, text), public.sv_nummer_nachtragen(uuid, text)
  to authenticated;
revoke execute on function app.stammdaten_schuetzen() from public, anon, authenticated;
