/**
 * Contas de usuário. O e-mail é guardado em minúsculas: a normalização acontece
 * na entrada (serviço de autenticação), então a busca aqui é por igualdade simples.
 */
export function createUsersRepository(db) {
  const insertStmt = db.prepare(
    `INSERT INTO users (email, password_hash, nome, termos_versao, termos_aceitos_em)
     VALUES (?, ?, ?, ?, ?)`,
  );
  // ON DELETE CASCADE leva junto as páginas, os snapshots, os alertas e as sessões.
  const deleteStmt = db.prepare('DELETE FROM users WHERE id = ?');
  const findByEmailStmt = db.prepare(
    'SELECT id, email, nome, password_hash FROM users WHERE email = ?',
  );
  const findByIdStmt = db.prepare('SELECT id, email, nome FROM users WHERE id = ?');
  const setPasswordStmt = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
  const findAuthByIdStmt = db.prepare(
    'SELECT id, email, nome, password_hash FROM users WHERE id = ?',
  );
  const updateStmt = db.prepare(
    'UPDATE users SET nome = ?, email = ?, password_hash = ? WHERE id = ?',
  );

  return {
    create({ email, passwordHash = null, nome = null, termosVersao = null, termosAceitosEm = null }) {
      const result = insertStmt.run(email, passwordHash, nome, termosVersao, termosAceitosEm);
      return Number(result.lastInsertRowid);
    },

    delete(id) {
      deleteStmt.run(id);
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

    // Usado só para conferir a senha atual ao alterar a conta.
    findAuthById(id) {
      return findAuthByIdStmt.get(id);
    },

    update({ id, nome, email, passwordHash }) {
      updateStmt.run(nome, email, passwordHash, id);
    },
  };
}
