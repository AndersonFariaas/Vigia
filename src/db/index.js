import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DEFAULT_DATABASE_PATH = './data/vigia.db';
const MEMORY_DATABASE = ':memory:';

/**
 * Abre o banco com integridade e desempenho adequados:
 * - WAL: leituras não bloqueiam a escrita do agendador;
 * - foreign_keys: sem ela o SQLite ignora ON DELETE CASCADE.
 */
export function openDatabase(path = DEFAULT_DATABASE_PATH) {
  if (path !== MEMORY_DATABASE) {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

/**
 * Executa `fn` numa transação. O SQLite do node:sqlite é síncrono, então
 * `fn` não pode ter `await`: uma escrita parcial é o que a transação evita.
 */
export function withTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}
