export class DuplicateMonitorError extends Error {
  constructor() {
    super('Você já monitora esta página.');
    this.name = 'DuplicateMonitorError';
    this.code = 'MONITOR_DUPLICADO';
    this.status = 409;
    this.expose = true;
  }
}

const UNIQUE_VIOLATION = 'UNIQUE constraint failed';

/**
 * Acesso a monitores. Toda consulta recebe `userId` e filtra por ele. Só o agendador
 * lista monitores de todos os usuários, pelo `findDue`.
 */
export function createMonitorsRepository(db) {
  const insertStmt = db.prepare(`
    INSERT INTO monitors (user_id, url, label, interval_minutes)
    VALUES (?, ?, ?, ?)
  `);
  const findForUserStmt = db.prepare('SELECT * FROM monitors WHERE id = ? AND user_id = ?');
  const listForUserStmt = db.prepare(
    'SELECT * FROM monitors WHERE user_id = ? ORDER BY created_at DESC, id DESC',
  );
  const deleteForUserStmt = db.prepare('DELETE FROM monitors WHERE id = ? AND user_id = ?');

  // julianday converte o ISO 8601 de forma confiável; comparar strings não é seguro com fuso.
  const findDueStmt = db.prepare(`
    SELECT * FROM monitors
    WHERE active = 1
      AND (
        last_checked_at IS NULL
        OR julianday(last_checked_at) + interval_minutes / 1440.0 <= julianday(?)
      )
    ORDER BY last_checked_at IS NULL DESC, last_checked_at ASC
    LIMIT ?
  `);
  const updateResultStmt = db.prepare(`
    UPDATE monitors
    SET last_checked_at = ?, last_status = ?, last_error = ?
    WHERE id = ? AND user_id = ?
  `);

  return {
    create({ userId, url, label, intervalMinutes }) {
      try {
        const result = insertStmt.run(userId, url, label, intervalMinutes);
        return findForUserStmt.get(Number(result.lastInsertRowid), userId);
      } catch (error) {
        if (error.message?.includes(UNIQUE_VIOLATION)) throw new DuplicateMonitorError();
        throw error;
      }
    },

    listByUser(userId) {
      return listForUserStmt.all(userId);
    },

    findByIdForUser(userId, id) {
      return findForUserStmt.get(id, userId);
    },

    findDue(nowIso, limit) {
      return findDueStmt.all(nowIso, limit);
    },

    updateCheckResult(userId, id, { checkedAt, status, error }) {
      updateResultStmt.run(checkedAt, status, error, id, userId);
    },

    deleteForUser(userId, id) {
      return deleteForUserStmt.run(id, userId).changes > 0;
    },
  };
}
