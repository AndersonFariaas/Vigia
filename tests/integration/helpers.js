import { openDatabase } from '../../src/db/index.js';
import { applyMigrations } from '../../src/db/migrate.js';
import { createAlertsRepository } from '../../src/db/repositories/alerts.js';
import { createAnalysesRepository } from '../../src/db/repositories/analyses.js';
import { createMonitorsRepository } from '../../src/db/repositories/monitors.js';
import { createSessionsRepository } from '../../src/db/repositories/sessions.js';
import { createSnapshotsRepository } from '../../src/db/repositories/snapshots.js';
import { createUsersRepository } from '../../src/db/repositories/users.js';
import { createAuthService } from '../../src/services/auth/authService.js';
import { SESSION_COOKIE } from '../../src/security/sessionToken.js';

/** Banco em memória com migrations aplicadas e uma conta de teste criada. */
export function createTestContext() {
  const db = openDatabase(':memory:');
  applyMigrations(db);

  const repos = {
    users: createUsersRepository(db),
    sessions: createSessionsRepository(db),
    monitors: createMonitorsRepository(db),
    snapshots: createSnapshotsRepository(db),
    alerts: createAlertsRepository(db),
    analyses: createAnalysesRepository(db),
  };
  const auth = createAuthService({ users: repos.users, sessions: repos.sessions });
  const ownerId = repos.users.create({ email: 'dono@exemplo.com' });

  return {
    db,
    ownerId,
    repos,
    auth,
    /** Cookie de sessão válido para um usuário existente (sem passar pelo login HTTP). */
    cookieFor(userId) {
      return `${SESSION_COOKIE}=${auth.openSession(userId)}`;
    },
    count(table) {
      return db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total;
    },
  };
}
