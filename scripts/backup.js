// Cópia do banco: `npm run backup`. Não exige as chaves de API, só o caminho do banco.
// Variáveis: DATABASE_PATH (banco), BACKUP_DIR (pasta das cópias), BACKUP_KEEP (quantas manter).
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DEFAULT_DATABASE_PATH, openDatabase } from '../src/db/index.js';
import { createBackup } from '../src/services/backup.js';

const DEFAULT_BACKUP_DIR = './backups';
const DEFAULT_BACKUP_KEEP = 7;

export function readBackupSettings(env = process.env) {
  const keep = Number(env.BACKUP_KEEP ?? DEFAULT_BACKUP_KEEP);
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error('BACKUP_KEEP deve ser um número inteiro de pelo menos 1.');
  }
  return {
    databasePath: env.DATABASE_PATH || DEFAULT_DATABASE_PATH,
    dir: env.BACKUP_DIR || DEFAULT_BACKUP_DIR,
    keep,
  };
}

// Execução direta: `npm run backup`.
const isEntryPoint = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isEntryPoint) {
  if (existsSync('.env')) process.loadEnvFile('.env');

  const { databasePath, dir, keep } = readBackupSettings(process.env);
  // Não cria um banco vazio por engano: se o arquivo não existe, o erro aparece aqui.
  if (!existsSync(databasePath)) {
    console.error(`Banco não encontrado em ${databasePath}. Confira DATABASE_PATH.`);
    process.exit(1);
  }

  const db = openDatabase(databasePath);
  try {
    const { path, removed } = createBackup({ db, dir, keep });
    console.log(`Cópia criada em ${path}. Cópias antigas removidas: ${removed}.`);
  } finally {
    db.close();
  }
}
