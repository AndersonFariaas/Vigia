import { openDatabase } from '../../src/db/index.js';
import { applyMigrations } from '../../src/db/migrate.js';
import { createAlertsRepository } from '../../src/db/repositories/alerts.js';
import { createMonitorsRepository } from '../../src/db/repositories/monitors.js';
import { createSnapshotsRepository } from '../../src/db/repositories/snapshots.js';
import { ensureOwner, OWNER_ID } from '../../src/db/repositories/users.js';

/** Banco em memória com migrations aplicadas e a conta única criada. */
export function createTestContext() {
  const db = openDatabase(':memory:');
  applyMigrations(db);
  ensureOwner(db, 'dono@exemplo.com');

  return {
    db,
    ownerId: OWNER_ID,
    repos: {
      monitors: createMonitorsRepository(db),
      snapshots: createSnapshotsRepository(db),
      alerts: createAlertsRepository(db),
    },
    count(table) {
      return db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total;
    },
  };
}
