-- Juez del Tiempo: el servidor es la única fuente de verdad.
-- Notion y los calendarios externos son copias o lecturas, nunca dueños del dato.

CREATE TABLE IF NOT EXISTS settings (
  key    text PRIMARY KEY,
  value  jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id_hash     text PRIMARY KEY,
  label       text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hash          text UNIQUE NOT NULL,
  label         text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);

-- Tareas y rutinas.
CREATE TABLE IF NOT EXISTS items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('tarea','rutina')),
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  status      text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','en curso','hecha','archivada')),
  est_min     integer NOT NULL DEFAULT 30 CHECK (est_min BETWEEN 1 AND 1440),
  due_date    date,
  hora        time,                       -- rutina: hora fija (opcional)
  dias        smallint[],                 -- rutina: 0=domingo … 6=sábado
  notion_id   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS items_kind ON items(kind, status);

CREATE TABLE IF NOT EXISTS sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     uuid REFERENCES items(id) ON DELETE SET NULL,
  title       text NOT NULL,
  state       text NOT NULL CHECK (state IN ('running','paused','done')),
  started_at  timestamptz NOT NULL,
  ended_at    timestamptz,
  source      text NOT NULL DEFAULT 'app',
  notion_id   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Una sola actividad abierta, venga del dispositivo que venga.
CREATE UNIQUE INDEX IF NOT EXISTS una_abierta ON sessions ((true)) WHERE state IN ('running','paused');
CREATE INDEX IF NOT EXISTS sessions_inicio ON sessions(started_at DESC);

CREATE TABLE IF NOT EXISTS segments (
  id          bigserial PRIMARY KEY,
  session_id  uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  started_at  timestamptz NOT NULL,
  ended_at    timestamptz,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX IF NOT EXISTS segments_sesion ON segments(session_id);

-- Agenda propia (lo que planeas). Lo medido vive en sessions.
CREATE TABLE IF NOT EXISTS blocks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     uuid REFERENCES items(id) ON DELETE CASCADE,
  title       text NOT NULL,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL CHECK (ends_at > starts_at),
  origin      text NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','auto')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blocks_inicio ON blocks(starts_at);

CREATE TABLE IF NOT EXISTS captures (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL DEFAULT 'captura' CHECK (kind IN ('captura','nota')),
  text        text NOT NULL CHECK (length(text) BETWEEN 1 AND 300),
  body        text NOT NULL DEFAULT '',
  source      text NOT NULL DEFAULT 'app',
  status      text NOT NULL DEFAULT 'abierta' CHECK (status IN ('abierta','procesada')),
  notion_id   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Calendarios externos leídos por su enlace iCal privado (Google, iCloud, Outlook).
CREATE TABLE IF NOT EXISTS calendars (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  url         text NOT NULL,
  last_ok_at  timestamptz,
  last_error  text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS calendar_events (
  calendar_id  uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  uid          text NOT NULL,
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  title        text NOT NULL,
  all_day      boolean NOT NULL DEFAULT false,
  PRIMARY KEY (calendar_id, uid, starts_at)
);
CREATE INDEX IF NOT EXISTS cal_events_inicio ON calendar_events(starts_at);

-- Copia hacia Notion: cola de una sola dirección con reintentos.
CREATE TABLE IF NOT EXISTS outbox (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('item','session','capture')),
  ref         uuid NOT NULL,
  status      text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','ok','error')),
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text NOT NULL DEFAULT '',
  next_at     timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  done_at     timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_pendiente ON outbox(next_at) WHERE status <> 'ok';

CREATE TABLE IF NOT EXISTS activity (
  id      bigserial PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  kind    text NOT NULL,
  detail  text NOT NULL DEFAULT ''
);
