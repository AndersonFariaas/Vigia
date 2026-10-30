import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_DATABASE_PATH, openDatabase, withTransaction } from './index.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Aplica cada migration da pasta uma única vez, em ordem de nome.
 * Cada uma roda numa transação: falhou no meio, nada fica pela metade.
 */
export function applyMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((row) => row.name),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const newlyApplied = [];
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    withTransaction(db, () => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
    });
    newlyApplied.push(file);
  }

  return newlyApplied;
}

// Execução direta: `npm run migrate`. Não exige as chaves de API.
const isEntryPoint = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isEntryPoint) {
  const path = process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH;
  const db = openDatabase(path);
  const applied = applyMigrations(db);
  db.close();
  console.log(
    applied.length
      ? `Migrations aplicadas: ${applied.join(', ')}`
      : 'Banco já está atualizado.',
  );
}
