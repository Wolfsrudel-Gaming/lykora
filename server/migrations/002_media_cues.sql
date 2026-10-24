-- Medien der Spiele (Klänge, Bilder, Videos) und Klang-Cues der Spielleitung

-- Dateien liegen inhaltsadressiert unter DATA_DIR/media/<sha256>.<Endung>;
-- mehrere Einträge (auch aus verschiedenen Spielen) können dieselbe Datei nutzen.
create table game_media (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references games(id) on delete cascade,
  org_id        uuid not null references organizations(id) on delete cascade,
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  filename      text not null,
  content_type  text not null,
  kind          text not null check (kind in ('audio', 'image', 'video')),
  size          integer not null check (size > 0),
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (game_id, sha256)
);
create index on game_media (sha256);

-- Ein Cue lässt beim Team einen Klang abspielen; der Body ist JSON mit audio, src, volume und text.
alter table messages drop constraint messages_kind_check;
alter table messages add constraint messages_kind_check
  check (kind in ('chat', 'hint', 'system', 'story', 'predefined', 'cue'));
