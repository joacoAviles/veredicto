-- Veredicto 2: cuentas conectadas y sincronización en ambos sentidos.
-- Cada cuenta externa sigue siendo dueña de lo suyo; aquí se guarda el espejo y la cola de cambios.

CREATE TABLE IF NOT EXISTS cuentas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo        text NOT NULL CHECK (tipo IN ('caldav','google','outlook','markdown','notion')),
  nombre      text NOT NULL,
  config      text NOT NULL,              -- JSON cifrado (AES-256-GCM)
  activa      boolean NOT NULL DEFAULT true,
  ultimo_ok   timestamptz,
  ultimo_error text NOT NULL DEFAULT '',
  error_desde timestamptz,
  creada      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE calendars ADD COLUMN IF NOT EXISTS cuenta_id uuid REFERENCES cuentas(id) ON DELETE CASCADE;
ALTER TABLE calendars ADD COLUMN IF NOT EXISTS remote_id text;
ALTER TABLE calendars ADD COLUMN IF NOT EXISTS rol text NOT NULL DEFAULT 'leer' CHECK (rol IN ('leer','plan','registrado','oculto'));
ALTER TABLE calendars ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE calendars ADD COLUMN IF NOT EXISTS editable boolean NOT NULL DEFAULT false;
ALTER TABLE calendars ALTER COLUMN url DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS calendars_remoto ON calendars(cuenta_id, remote_id) WHERE cuenta_id IS NOT NULL;

ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS href text;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS etag text;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS recurrente boolean NOT NULL DEFAULT false;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS remoto_editado timestamptz;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS local_editado timestamptz;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS extra jsonb NOT NULL DEFAULT '{}';

ALTER TABLE blocks ADD COLUMN IF NOT EXISTS calendar_id uuid REFERENCES calendars(id) ON DELETE SET NULL;
ALTER TABLE blocks ADD COLUMN IF NOT EXISTS remote_uid text;
ALTER TABLE blocks ADD COLUMN IF NOT EXISTS href text;
ALTER TABLE blocks ADD COLUMN IF NOT EXISTS etag text;
ALTER TABLE blocks ADD COLUMN IF NOT EXISTS borrado timestamptz;
ALTER TABLE blocks ADD COLUMN IF NOT EXISTS actualizado timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS blocks_remoto ON blocks(calendar_id, remote_uid) WHERE remote_uid IS NOT NULL;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cal_ref jsonb;

ALTER TABLE items ADD COLUMN IF NOT EXISTS fuente text NOT NULL DEFAULT 'app';
ALTER TABLE items ADD COLUMN IF NOT EXISTS cuenta_id uuid REFERENCES cuentas(id) ON DELETE CASCADE;
ALTER TABLE items ADD COLUMN IF NOT EXISTS ext_id text;
ALTER TABLE items ADD COLUMN IF NOT EXISTS nota_ref text;
ALTER TABLE items ADD COLUMN IF NOT EXISTS nota_titulo text;
CREATE UNIQUE INDEX IF NOT EXISTS items_externo ON items(cuenta_id, ext_id) WHERE ext_id IS NOT NULL;

-- Versión vista de cada nota (mtime de un .md o last_edited_time de Notion).
CREATE TABLE IF NOT EXISTS notas_estado (
  cuenta_id uuid NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  ref       text NOT NULL,
  titulo    text NOT NULL DEFAULT '',
  version   text NOT NULL,
  abiertas  integer NOT NULL DEFAULT 0,
  visto     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cuenta_id, ref)
);

CREATE TABLE IF NOT EXISTS conflictos (
  id        bigserial PRIMARY KEY,
  objeto    text NOT NULL,
  ref       text NOT NULL,
  titulo    text NOT NULL DEFAULT '',
  ganador   text NOT NULL CHECK (ganador IN ('local','remoto')),
  perdedor  jsonb NOT NULL,
  creado    timestamptz NOT NULL DEFAULT now(),
  revisado  boolean NOT NULL DEFAULT false
);

ALTER TABLE outbox DROP CONSTRAINT IF EXISTS outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN ('item','session','capture','bloque','evento','sesion_cal','gestion','bandeja'));
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS datos jsonb NOT NULL DEFAULT '{}';
ALTER TABLE outbox ALTER COLUMN ref DROP NOT NULL;
