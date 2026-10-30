/**
 * Garante a conta única da Fase 1 (id = 1). O e-mail é o destino dos alertas,
 * então é atualizado a cada inicialização caso o .env mude.
 * Na Fase 3 isso vira o cadastro real de usuários.
 */
export const OWNER_ID = 1;

export function ensureOwner(db, email) {
  db.prepare(`
    INSERT INTO users (id, email) VALUES (?, ?)
    ON CONFLICT (id) DO UPDATE SET email = excluded.email
  `).run(OWNER_ID, email);
  return OWNER_ID;
}
