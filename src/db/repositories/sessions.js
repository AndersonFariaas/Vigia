/**
 * Sessões de login. A chave é o hash do token: quem tem o cookie apresenta o token,
 * e o servidor calcula o hash para achar a sessão.
 */
export function createSessionsRepository(db) {
  const insertStmt = db.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (?, ?, ?)
  `);
  const findActiveStmt = db.prepare(`
    SELECT u.id, u.email, u.nome
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `);
  const deleteStmt = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  const deleteExpiredStmt = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');

  return {
    create({ tokenHash, userId, expiresAt }) {
      insertStmt.run(tokenHash, userId, expiresAt);
    },

    findActiveUser(tokenHash, nowIso) {
      return findActiveStmt.get(tokenHash, nowIso);
    },

    delete(tokenHash) {
      deleteStmt.run(tokenHash);
    },

    deleteExpired(nowIso) {
      return deleteExpiredStmt.run(nowIso).changes;
    },
  };
}
