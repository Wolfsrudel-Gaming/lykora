-- NFC-Armbänder: Armbänder von Spielleitung und Betreuern je Event, Vollzähligkeits-Check

create table event_tags (
  event_id    uuid not null references events(id) on delete cascade,
  -- Nur der Hash der Armband-ID wird gespeichert, siehe tagHash().
  tag_hash    text not null,
  role        text not null check (role in ('staff', 'supervisor')),
  label       text,
  created_at  timestamptz not null default now(),
  primary key (event_id, tag_hash)
);

alter table teams add column last_headcount jsonb;
