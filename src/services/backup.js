import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const FILE_PATTERN = /^vigia-\d{8}-\d{6}\.db$/;

/** Nome do arquivo em UTC: AAAAMMDD-HHMMSS. Nomes com largura fixa ordenam por data. */
export function backupFileName(date) {
  const iso = date.toISOString();
  const day = iso.slice(0, 10).replaceAll('-', '');
  const time = iso.slice(11, 19).replaceAll(':', '');
  return `vigia-${day}-${time}.db`;
}

/** Apaga as cópias mais antigas e mantém só as `keep` mais recentes. Devolve quantas foram apagadas. */
export function pruneBackups(dir, keep) {
  if (!existsSync(dir)) return 0;
  const files = readdirSync(dir)
    .filter((name) => FILE_PATTERN.test(name))
    .sort();
  const obsolete = files.slice(0, Math.max(0, files.length - keep));
  for (const name of obsolete) unlinkSync(join(dir, name));
  return obsolete.length;
}

/**
 * Copia o banco com VACUUM INTO: a cópia é consistente mesmo com o servidor escrevendo (WAL).
 * Não copie o arquivo .db na mão: com o WAL ativo, ele pode sair incompleto.
 */
export function createBackup({ db, dir, keep, now = () => new Date() }) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, backupFileName(now()));
  if (existsSync(path)) {
    throw new Error('Já existe uma cópia com este horário. Aguarde um segundo e tente de novo.');
  }
  db.prepare('VACUUM INTO ?').run(path);
  const removed = pruneBackups(dir, keep);
  return { path, removed };
}
