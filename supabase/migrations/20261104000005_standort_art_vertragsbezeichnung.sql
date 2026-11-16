-- Staff-Solutions - Migration 005: Standort-Art, Vertragsbezeichnung, Ort je Unterschrift
alter table public.standort add column art text not null default 'studio'
  check (art in ('studio', 'buero'));
alter table public.standort add column vertragsbezeichnung text;
alter table public.unterschrift add column ort text;
