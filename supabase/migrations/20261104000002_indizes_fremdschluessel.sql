-- Staff-Solutions - Migration 002: zusammengesetzte Indizes für Mandanten-Fremdschlüssel
drop index if exists public.standort_gesellschaft_id_idx;
drop index if exists public.standort_tarifzone_id_idx;
drop index if exists public.profil_mitarbeiter_id_idx;
drop index if exists public.dienstverhaeltnis_mitarbeiter_id_idx;
drop index if exists public.dienstverhaeltnis_gesellschaft_id_idx;
drop index if exists public.dienstverhaeltnis_heimstandort_id_idx;
drop index if exists public.dienstverhaeltnis_funktion_id_idx;
drop index if exists public.brutto_tabelle_tarifzone_id_netto_gueltig_ab_idx;
drop index if exists public.vorlage_funktion_id_idx;
drop index if exists public.dokument_dienstverhaeltnis_id_idx;
drop index if exists public.dokument_vorlage_id_idx;

create index on public.standort (gesellschaft_id, organisation_id);
create index on public.standort (tarifzone_id, organisation_id);
create index on public.profil (mitarbeiter_id, organisation_id);
create index on public.dienstverhaeltnis (mitarbeiter_id, organisation_id);
create index on public.dienstverhaeltnis (gesellschaft_id, organisation_id);
create index on public.dienstverhaeltnis (heimstandort_id, gesellschaft_id);
create index on public.dienstverhaeltnis (funktion_id, organisation_id);
create index on public.entgelt (dienstverhaeltnis_id, organisation_id);
create index on public.entgelt (created_by);
create index on public.brutto_tabelle (tarifzone_id, organisation_id, netto, gueltig_ab desc);
create index on public.vorlage (funktion_id, organisation_id);
create index on public.dokument (dienstverhaeltnis_id, organisation_id);
create index on public.dokument (vorlage_id, organisation_id);
create index on public.dokument (created_by);
create index on public.dokument (unterschrieben_von);
create index on public.dokument (gegengezeichnet_von);
