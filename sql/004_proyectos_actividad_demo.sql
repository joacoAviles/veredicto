-- Veredicto 3: pilares y proyectos (como el Juez del Tiempo), actividad del computador (ActivityWatch),
-- datos de ejemplo marcados y espejo de las 9 bases de Notion.

CREATE TABLE IF NOT EXISTS pilares (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     text NOT NULL,
  color      text,
  notas      text NOT NULL DEFAULT '',
  estado     text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','archivado')),
  orden      integer NOT NULL DEFAULT 0,
  demo       boolean NOT NULL DEFAULT false,
  creado     timestamptz NOT NULL DEFAULT now(),
  actualizado timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proyectos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pilar_id    uuid REFERENCES pilares(id) ON DELETE SET NULL,
  nombre      text NOT NULL,
  estado      text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','pausado','terminado','archivado')),
  fecha_limite date,
  minutos_plan integer,
  color       text,
  notas       text NOT NULL DEFAULT '',
  demo        boolean NOT NULL DEFAULT false,
  creado      timestamptz NOT NULL DEFAULT now(),
  actualizado timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE items ADD COLUMN IF NOT EXISTS proyecto_id uuid REFERENCES proyectos(id) ON DELETE SET NULL;
ALTER TABLE items ADD COLUMN IF NOT EXISTS eisenhower text;
ALTER TABLE items ADD COLUMN IF NOT EXISTS demo boolean NOT NULL DEFAULT false;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS demo boolean NOT NULL DEFAULT false;
ALTER TABLE blocks ADD COLUMN IF NOT EXISTS demo boolean NOT NULL DEFAULT false;
ALTER TABLE captures ADD COLUMN IF NOT EXISTS demo boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS items_proyecto ON items(proyecto_id);

-- Actividad del computador, resumida por tramo (app + título) desde ActivityWatch.
CREATE TABLE IF NOT EXISTS actividad (
  id        bigserial PRIMARY KEY,
  fuente    text NOT NULL,                    -- nombre del equipo (bucket de ActivityWatch)
  inicio    timestamptz NOT NULL,
  fin       timestamptz NOT NULL,
  app       text NOT NULL,
  titulo    text NOT NULL DEFAULT '',
  registrado boolean NOT NULL DEFAULT false,  -- ya se convirtió en registro de tiempo
  demo      boolean NOT NULL DEFAULT false,
  UNIQUE (fuente, inicio, app, titulo)
);
CREATE INDEX IF NOT EXISTS actividad_inicio ON actividad(inicio);

-- Espejo en Notion: qué página corresponde a cada cosa de Veredicto en cada base.
CREATE TABLE IF NOT EXISTS notion_espejo (
  base     text NOT NULL,    -- pilares | proyectos | tareas | ideas | rutinas | recurrencias | calendario | sesiones | actividad
  ref      text NOT NULL,    -- id en Veredicto
  page_id  text NOT NULL,
  version  text NOT NULL DEFAULT '',
  PRIMARY KEY (base, ref)
);

ALTER TABLE outbox DROP CONSTRAINT IF EXISTS outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN ('item','session','capture','bloque','evento','sesion_cal','gestion','bandeja','espejo'));
