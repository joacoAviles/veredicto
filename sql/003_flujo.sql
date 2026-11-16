-- Flujo de Notion: idea → por hacer → agendada (bloque en el calendario) → tiempo registrado → hecha.
ALTER TABLE items ADD COLUMN IF NOT EXISTS etapa text;
ALTER TABLE items ADD COLUMN IF NOT EXISTS tipo_nota text;
ALTER TABLE items ADD COLUMN IF NOT EXISTS agendable boolean NOT NULL DEFAULT false;
ALTER TABLE items ADD COLUMN IF NOT EXISTS bloque_id uuid REFERENCES blocks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS items_agendables ON items(agendable) WHERE agendable;
