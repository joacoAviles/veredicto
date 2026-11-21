-- Veredicto 3.1: agentes de IA (módulo Infraestructura, opcional) y carpeta sincronizada.
-- Veredicto sigue siendo la única verdad: los agentes y las carpetas leen y piden cambios por su propia API.

-- Un token es de atajo (Siri, reloj, MCP), de agente (Hermes: /api/agente y MCP) o de carpeta (/api/carpeta).
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS alcance text NOT NULL DEFAULT 'atajo' CHECK (alcance IN ('atajo','agente','carpeta'));

-- Tareas para agentes.
-- Urgencia en la cola de agentes (1 urgente … 4 cuando se pueda). Tus tareas siguen usando Eisenhower.
ALTER TABLE items ADD COLUMN IF NOT EXISTS prioridad smallint CHECK (prioridad BETWEEN 1 AND 4);
ALTER TABLE items ADD COLUMN IF NOT EXISTS asignado text NOT NULL DEFAULT 'yo' CHECK (asignado IN ('yo','agente'));
ALTER TABLE items ADD COLUMN IF NOT EXISTS carril text NOT NULL DEFAULT 'local' CHECK (carril IN ('local','cloud'));
ALTER TABLE items ADD COLUMN IF NOT EXISTS ventana text NOT NULL DEFAULT 'dia' CHECK (ventana IN ('dia','noche'));
ALTER TABLE items ADD COLUMN IF NOT EXISTS agente_estado text CHECK (agente_estado IN ('cola','trabajando','revision','bloqueada','aprobada','rechazada'));
ALTER TABLE items ADD COLUMN IF NOT EXISTS agente_por text;
ALTER TABLE items ADD COLUMN IF NOT EXISTS agente_desde timestamptz;
ALTER TABLE items ADD COLUMN IF NOT EXISTS cloud_ok boolean NOT NULL DEFAULT false;
ALTER TABLE items ADD COLUMN IF NOT EXISTS detalle text NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN IF NOT EXISTS resultado text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS items_agente ON items(agente_estado, carril) WHERE asignado='agente';

-- Cada agente que se reporta (latido): para la hoja de Infraestructura.
CREATE TABLE IF NOT EXISTS agentes (
  nombre    text PRIMARY KEY,
  carril    text NOT NULL DEFAULT 'local',
  modelo    text NOT NULL DEFAULT '',
  maquina   text NOT NULL DEFAULT '',
  estado    text NOT NULL DEFAULT '',
  item_id   uuid REFERENCES items(id) ON DELETE SET NULL,
  visto     timestamptz NOT NULL DEFAULT now()
);

-- Historial de lo que hizo cada agente con cada tarea.
CREATE TABLE IF NOT EXISTS agente_eventos (
  id       bigserial PRIMARY KEY,
  item_id  uuid REFERENCES items(id) ON DELETE CASCADE,
  agente   text NOT NULL DEFAULT '',
  tipo     text NOT NULL,
  texto    text NOT NULL DEFAULT '',
  at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agente_eventos_item ON agente_eventos(item_id, at DESC);
