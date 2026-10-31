/**
 * Contas de usuário. O e-mail é guardado em minúsculas: a normalização acontece
 * na entrada (serviço de autenticação), então a busca aqui é por igualdade simples.
 */
export function createUsersRepository(db) {
  const insertStmt = db.prepare(
    'INSERT INTO users (email, password_hash, nome) VALUES (?, ?, ?)',
  );
  const findByEmailStmt = db.prepare(
    'SELECT id, email, nome, password_hash FROM users WHERE email = ?',
  );
  const findByIdStmt = db.prepare('SELECT id, email, nome FROM users WHERE id = ?');
  const setPasswordStmt = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');

  return {
    create({ email, passwordHash = null, nome = null }) {
      return Number(insertStmt.run(email, passwordHash, nome).lastInsertRowid);
    },

    findByEmail(email) {
      return findByEmailStmt.get(email);
    },

    findById(id) {
      return findByIdStmt.get(id);
    },

    setPassword(id, passwordHash) {
      setPasswordStmt.run(passwordHash, id);
    },
  };
}
