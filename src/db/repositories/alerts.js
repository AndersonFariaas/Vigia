/**
 * Alertas: cada mudança vira um registro com o diff em JSON.
 * `send_status` controla o envio: só 'pendente' entra no próximo lote.
 */
export const SEND_STATUS = Object.freeze({
  PENDENTE: 'pendente',
  ENVIADO: 'enviado',
  FALHOU: 'falhou',
});

function parseAlert(row) {
  return { ...row, details: JSON.parse(row.details) };
}

export function createAlertsRepository(db) {
  const insertStmt = db.prepare(`
    INSERT INTO alerts (monitor_id, kind, severity, details)
    VALUES (?, ?, ?, ?)
  `);
  const listForUserStmt = db.prepare(`
    SELECT a.*
    FROM alerts a
    JOIN monitors m ON m.id = a.monitor_id
    WHERE a.monitor_id = ? AND m.user_id = ?
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ?
  `);
  const pendingWithMonitorStmt = db.prepare(`
    SELECT a.*, m.url AS monitor_url, m.label AS monitor_label
    FROM alerts a
    JOIN monitors m ON m.id = a.monitor_id
    WHERE a.send_status = ?
    ORDER BY a.created_at ASC, a.id ASC
    LIMIT ?
  `);
  const markSentStmt = db.prepare(`
    UPDATE alerts SET send_status = ?, sent_at = ? WHERE id = ?
  `);
  const markFailedStmt = db.prepare('UPDATE alerts SET send_status = ? WHERE id = ?');

  return {
    insert({ monitorId, kind, severity, details }) {
      const result = insertStmt.run(monitorId, kind, severity, JSON.stringify(details));
      return Number(result.lastInsertRowid);
    },

    listForUser(userId, monitorId, limit) {
      return listForUserStmt.all(monitorId, userId, limit).map(parseAlert);
    },

    findPendingWithMonitor(limit) {
      return pendingWithMonitorStmt
        .all(SEND_STATUS.PENDENTE, limit)
        .map(parseAlert);
    },

    markSent(id, sentAt) {
      markSentStmt.run(SEND_STATUS.ENVIADO, sentAt, id);
    },

    markFailed(id) {
      markFailedStmt.run(SEND_STATUS.FALHOU, id);
    },
  };
}
