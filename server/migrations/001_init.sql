-- Grundschema für Lykora 0.1

create extension if not exists pgcrypto;

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now()
);

create table users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique,
  name           text not null,
  password_hash  text not null,
  disabled       boolean not null default false,
  created_at     timestamptz not null default now()
);

create table memberships (
  user_id  uuid not null references users(id) on delete cascade,
  org_id   uuid not null references organizations(id) on delete cascade,
  role     text not null check (role in ('admin', 'author', 'gamemaster', 'supervisor', 'actor', 'viewer')),
  primary key (user_id, org_id)
);

create table sessions (
  token_hash  text primary key,
  user_id     uuid not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index on sessions (user_id);

create table games (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  title       text not null,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on games (org_id);

create table game_versions (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references games(id) on delete cascade,
  version     integer not null,
  content     jsonb not null,
  comment     text,
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (game_id, version)
);

create table events (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  game_version_id  uuid not null references game_versions(id),
  name             text not null,
  join_code        text not null unique,
  -- PIN für Betreuer; bestätigt beim Team-Start, dass ein Betreuer dabei ist.
  supervisor_pin   text not null,
  status           text not null default 'draft'
                   check (status in ('draft', 'running', 'paused', 'recalled', 'ended')),
  -- Pausen als Liste von {from, to}; to fehlt bei laufender Pause.
  pauses           jsonb not null default '[]',
  retention_days   integer not null default 30,
  scheduled_at     timestamptz,
  started_at       timestamptz,
  ended_at         timestamptz,
  purged_at        timestamptz,
  created_by       uuid references users(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index on events (org_id);

create table teams (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references events(id) on delete cascade,
  name               text not null,
  color              text,
  members            jsonb not null default '[]',
  emergency_phone    text,
  -- Kurzer Code, mit dem weitere Handys dem Team beitreten.
  device_code        text not null,
  supervisor_present boolean not null default false,
  started_at         timestamptz,
  finished_at        timestamptz,
  arrived_at         timestamptz,
  last_seen_at       timestamptz,
  last_heartbeat_at  timestamptz,
  last_lat           double precision,
  last_lon           double precision,
  last_accuracy      double precision,
  last_position_at   timestamptz,
  battery            real,
  created_at         timestamptz not null default now(),
  unique (event_id, name),
  unique (event_id, device_code)
);

create table devices (
  token_hash    text primary key,
  team_id       uuid not null references teams(id) on delete cascade,
  label         text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);
create index on devices (team_id);

-- Aktionsprotokoll pro Team. Der Spielstand wird daraus berechnet.
create table actions (
  id           bigserial primary key,
  event_id     uuid not null references events(id) on delete cascade,
  team_id      uuid not null references teams(id) on delete cascade,
  client_id    text not null,
  source       text not null check (source in ('team', 'staff')),
  type         text not null,
  payload      jsonb not null default '{}',
  client_time  timestamptz not null,
  received_at  timestamptz not null default now(),
  user_id      uuid references users(id) on delete set null,
  unique (team_id, client_id)
);
create index on actions (team_id, client_time);

create table positions (
  id           bigserial primary key,
  event_id     uuid not null references events(id) on delete cascade,
  team_id      uuid not null references teams(id) on delete cascade,
  lat          double precision not null,
  lon          double precision not null,
  accuracy     double precision,
  recorded_at  timestamptz not null,
  received_at  timestamptz not null default now()
);
create index on positions (team_id, recorded_at);
create index on positions (event_id);

create table sos (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references events(id) on delete cascade,
  team_id          uuid not null references teams(id) on delete cascade,
  client_id        text,
  channel          text not null check (channel in ('app', 'deferred', 'sms', 'lora')),
  lat              double precision,
  lon              double precision,
  accuracy         double precision,
  message          text,
  client_time      timestamptz not null,
  received_at      timestamptz not null default now(),
  acknowledged_by  uuid references users(id) on delete set null,
  acknowledged_at  timestamptz,
  resolved_at      timestamptz,
  unique (team_id, client_id)
);
create index on sos (event_id);

create table messages (
  id          bigserial primary key,
  event_id    uuid not null references events(id) on delete cascade,
  -- null bei Nachrichten an alle Teams
  team_id     uuid references teams(id) on delete cascade,
  direction   text not null check (direction in ('to_team', 'from_team')),
  kind        text not null check (kind in ('chat', 'hint', 'system', 'story', 'predefined')),
  sender      text,
  user_id     uuid references users(id) on delete set null,
  body        text not null,
  client_id   text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index on messages (event_id, id);
create unique index on messages (team_id, client_id) where client_id is not null;

create table uploads (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  team_id       uuid references teams(id) on delete cascade,
  content_type  text not null,
  size          integer not null,
  path          text not null,
  created_at    timestamptz not null default now()
);

-- Logbuch aller Ereignisse eines Events.
create table event_log (
  id        bigserial primary key,
  event_id  uuid not null references events(id) on delete cascade,
  team_id   uuid references teams(id) on delete set null,
  user_id   uuid references users(id) on delete set null,
  kind      text not null,
  data      jsonb not null default '{}',
  at        timestamptz not null default now()
);
create index on event_log (event_id, id);
