-- Fase 1: conta única (ownerId = 1). O user_id já existe para o modelo multiusuário da Fase 3.

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE monitors (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  label TEXT,
  interval_minutes INTEGER NOT NULL CHECK (interval_minutes >= 15),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  last_checked_at TEXT,
  last_status TEXT,
  -- Mensagem já sanitizada (nunca o erro cru). Não existia no esquema original,
  -- mas sem ela o painel não consegue mostrar por que a checagem falhou.
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, url)
);

CREATE INDEX idx_monitors_active_checked ON monitors (active, last_checked_at);

CREATE TABLE snapshots (
  id INTEGER PRIMARY KEY,
  monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_snapshots_monitor_created ON snapshots (monitor_id, created_at);

CREATE TABLE alerts (
  id INTEGER PRIMARY KEY,
  monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('baixa', 'media', 'alta')),
  details TEXT NOT NULL,
  sent_at TEXT,
  send_status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (send_status IN ('pendente', 'enviado', 'falhou')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_alerts_monitor_created ON alerts (monitor_id, created_at);
CREATE INDEX idx_alerts_send_status ON alerts (send_status);
