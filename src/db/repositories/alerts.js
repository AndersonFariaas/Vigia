/**
 * Alertas: cada mudança vira um registro com o diff em JSON.
 * `send_status` controla o envio: só 'pendente' entra no próximo lote.
 */
export const SEND_STATUS = Object.freeze({
  PENDENTE: 'pendente',
  ENVIADO: 'enviado',
  FALHOU: 'falhou',
});

// Converte a linha do banco no formato usado pelo resto do código.
// A análise vem de um LEFT JOIN: fica null quando o alerta nunca foi analisado.
function parseAlert(row) {
  const { analysis_url: analysisUrl, analysis_created_at: analysisCreatedAt, ...alert } = row;
  return {
    ...alert,
    details: JSON.parse(row.details),
    analysis: analysisUrl ? { sessionUrl: analysisUrl, createdAt: analysisCreatedAt } : null,
  };
}

export function createAlertsRepository(db) {
  const insertStmt = db.prepare(`
    INSERT INTO alerts (monitor_id, kind, severity, details)
    VALUES (?, ?, ?, ?)
  `);
  const findForUserStmt = db.prepare(`
    SELECT a.*
    FROM alerts a
    JOIN monitors m ON m.id = a.monitor_id
    WHERE a.id = ? AND m.user_id = ?
  `);
  const listForUserStmt = db.prepare(`
    SELECT a.*, an.session_url AS analysis_url, an.created_at AS analysis_created_at
    FROM alerts a
    JOIN monitors m ON m.id = a.monitor_id
    LEFT JOIN analyses an ON an.alert_id = a.id
    WHERE a.monitor_id = ? AND m.user_id = ?
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ?
  `);
  // O e-mail vai para o dono do monitor, não para um endereço fixo.
  const pendingWithMonitorStmt = db.prepare(`
    SELECT a.*, m.url AS monitor_url, m.label AS monitor_label, u.email AS owner_email
    FROM alerts a
    JOIN monitors m ON m.id = a.monitor_id
    JOIN users u ON u.id = m.user_id
    WHERE a.send_status = ?
    ORDER BY a.created_at ASC, a.id ASC
    LIMIT ?
  `);
  const markSentStmt = db.prepare(`
    UPDATE alerts SET send_status = ?, sent_at = ? WHERE id = ?
  `);
  // Cada falha conta uma tentativa. Ao chegar no limite, o alerta para de tentar e fica 'falhou'.
  const markFailedStmt = db.prepare(`
    UPDATE alerts
    SET send_attempts = send_attempts + 1,
        send_status = CASE WHEN send_attempts + 1 >= ? THEN ? ELSE ? END
    WHERE id = ?
  `);
  const deleteOlderStmt = db.prepare('DELETE FROM alerts WHERE created_at < ?');

  return {
    insert({ monitorId, kind, severity, details }) {
      const result = insertStmt.run(monitorId, kind, severity, JSON.stringify(details));
      return Number(result.lastInsertRowid);
    },

    findForUser(userId, id) {
      const row = findForUserStmt.get(id, userId);
      return row ? { ...row, details: JSON.parse(row.details) } : undefined;
    },

    listForUser(userId, monitorId, limit) {
      return listForUserStmt.all(monitorId, userId, limit).map(parseAlert);
    },

    findPendingWithMonitor(limit) {
      return pendingWithMonitorStmt.all(SEND_STATUS.PENDENTE, limit).map(parseAlert);
    },

    markSent(id, sentAt) {
      markSentStmt.run(SEND_STATUS.ENVIADO, sentAt, id);
    },

    markFailed(id, maxAttempts) {
      markFailedStmt.run(maxAttempts, SEND_STATUS.FALHOU, SEND_STATUS.PENDENTE, id);
    },

    // Retenção (LGPD): remove alertas antes do limite. A análise da Devin cai junto (cascata).
    deleteOlderThan(cutoffIso) {
      return deleteOlderStmt.run(cutoffIso).changes;
    },
  };
}
