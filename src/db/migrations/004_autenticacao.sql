-- Fase 3: contas com senha e sessões de login.
-- Usuários antigos (conta única da Fase 1) ficam sem senha até o comando "npm run usuario".
ALTER TABLE users ADD COLUMN password_hash TEXT;

-- O token de sessão nunca é guardado: só o hash SHA-256. Vazamento do banco não entrega sessões ativas.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);
