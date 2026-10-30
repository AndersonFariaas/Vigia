-- Uma análise da Devin por alerta. UNIQUE(alert_id) impede dois agentes para o mesmo alerta
-- (e, portanto, duas cobranças). ON DELETE CASCADE acompanha o alerta.

CREATE TABLE analyses (
  id INTEGER PRIMARY KEY,
  alert_id INTEGER NOT NULL UNIQUE REFERENCES alerts(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  session_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
