-- Entwürfe des Baukastens, Probestände für Probeläufe, Test-Events

-- Ein Entwurf je Spiel; darf ungültig sein. Die Revision erkennt, wenn zwei Personen gleichzeitig speichern.
create table game_drafts (
  game_id      uuid primary key references games(id) on delete cascade,
  content      jsonb not null,
  -- Merker des Baukastens (Vorlage, Vor-Ort, ausgeblendete Hinweise, Checkliste); nie Teil des Spiels
  meta         jsonb not null default '{}',
  revision     integer not null default 1,
  -- Version, aus der der Entwurf stammt oder zuletzt veröffentlicht wurde; null, solange nie veröffentlicht
  base_version integer,
  updated_by   uuid references users(id) on delete set null,
  updated_at   timestamptz not null default now()
);

-- Probestände: Spielstand eines Probelaufs ohne Versionsnummer. Spiele dürfen ohne Version existieren.
-- Jede Abfrage nach Versionen filtert kind = 'release'; sonst käme bei "order by version desc" der Probestand (NULL) zuerst.
alter table game_versions alter column version drop not null;
alter table game_versions add column kind text not null default 'release' check (kind in ('release', 'test'));
alter table game_versions add constraint game_versions_release_has_number check (kind = 'test' or version is not null);
-- unique (game_id, version) bleibt: NULL-Versionen kollidieren nicht.

-- Probeläufe: Test-Events mit Probestand, nach 7 Tagen gelöscht.
alter table events add column test boolean not null default false;
create index on events (test) where test;
