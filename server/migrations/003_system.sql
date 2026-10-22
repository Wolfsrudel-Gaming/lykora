-- Einstellungen der Instanz und Verlauf der Server-Updates

-- Schlüssel "update": {"auto": false, "window": null | {"from": "03:00", "to": "05:00"}}
create table system_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references users(id) on delete set null
);

-- Ein laufendes Update steht hier mit state 'running', bis der Updater oder der neue Server es abschließt.
-- updated_at: letzter Bericht des Updaters; danach bemisst sich, ob ein Update liegengeblieben ist.
create table system_updates (
  id            uuid primary key default gen_random_uuid(),
  from_version  text,
  from_commit   text,
  to_version    text,
  to_commit     text,
  trigger       text not null check (trigger in ('auto', 'manual')),
  state         text not null check (state in ('running', 'succeeded', 'failed', 'rolled_back')),
  message       text,
  started_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index on system_updates (started_at desc);
