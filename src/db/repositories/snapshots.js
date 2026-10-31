/**
 * Snapshots guardam o texto normalizado de cada checagem que mudou.
 * Os métodos de leitura de usuário fazem JOIN com monitors para checar o dono.
 */
export const MAX_SNAPSHOTS_PER_MONITOR = 50;

export function createSnapshotsRepository(db) {
  const insertStmt = db.prepare(`
    INSERT INTO snapshots (monitor_id, content_hash, normalized_text, signals)
    VALUES (?, ?, ?, ?)
  `);
  const findLatestStmt = db.prepare(`
    SELECT * FROM snapshots
    WHERE monitor_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `);
  const listForUserStmt = db.prepare(`
    SELECT s.id, s.content_hash, s.created_at
    FROM snapshots s
    JOIN monitors m ON m.id = s.monitor_id
    WHERE s.monitor_id = ? AND m.user_id = ?
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT ?
  `);
  const deleteOlderStmt = db.prepare('DELETE FROM snapshots WHERE created_at < ?');
  const pruneStmt = db.prepare(`
    DELETE FROM snapshots
    WHERE monitor_id = ?
      AND id NOT IN (
        SELECT id FROM snapshots
        WHERE monitor_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      )
  `);

  return {
    insert({ monitorId, contentHash, normalizedText, signals }) {
      insertStmt.run(monitorId, contentHash, normalizedText, JSON.stringify(signals));
    },

    // `signals` volta já convertido em objeto. Leituras antigas (antes da Fase 2) viram {}.
    findLatest(monitorId) {
      const row = findLatestStmt.get(monitorId);
      return row ? { ...row, signals: JSON.parse(row.signals) } : undefined;
    },

    listForUser(userId, monitorId, limit) {
      return listForUserStmt.all(monitorId, userId, limit);
    },

    // Retenção (LGPD): remove snapshots criados antes do limite. Devolve quantos foram apagados.
    deleteOlderThan(cutoffIso) {
      return deleteOlderStmt.run(cutoffIso).changes;
    },

    pruneKeeping(monitorId, keep = MAX_SNAPSHOTS_PER_MONITOR) {
      pruneStmt.run(monitorId, monitorId, keep);
    },
  };
}
