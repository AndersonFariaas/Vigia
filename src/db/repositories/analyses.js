/**
 * Análises da Devin, uma por alerta. A checagem de dono é feita pelo alerta,
 * que já passa pelo filtro de user_id antes de chegar aqui.
 */
export function createAnalysesRepository(db) {
  const insertStmt = db.prepare(`
    INSERT INTO analyses (alert_id, session_id, session_url)
    VALUES (?, ?, ?)
  `);
  const findByAlertStmt = db.prepare('SELECT * FROM analyses WHERE alert_id = ?');

  return {
    insert({ alertId, sessionId, sessionUrl }) {
      insertStmt.run(alertId, sessionId, sessionUrl);
    },

    findByAlertId(alertId) {
      return findByAlertStmt.get(alertId);
    },
  };
}
