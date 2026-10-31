import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../src/db/index.js';
import { backupFileName, createBackup, pruneBackups } from '../../src/services/backup.js';
import { readBackupSettings } from '../../scripts/backup.js';
import { createTestContext } from './helpers.js';

let workDir;

before(() => {
  workDir = mkdtempSync(join(tmpdir(), 'vigia-backup-'));
});

after(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('backup: cópia consistente do banco', () => {
  test('gera um arquivo que abre como banco e tem os mesmos dados', () => {
    const ctx = createTestContext();
    const dir = join(workDir, 'copia-simples');
    ctx.repos.monitors.create({ userId: ctx.ownerId, url: 'https://exemplo.com/', label: null, intervalMinutes: 60 });

    const { path, removed } = createBackup({
      db: ctx.db,
      dir,
      keep: 7,
      now: () => new Date('2026-10-31T10:20:30.000Z'),
    });

    assert.equal(removed, 0);
    assert.equal(path, join(dir, 'vigia-20261031-102030.db'));
    const copy = openDatabase(path);
    try {
      assert.equal(copy.prepare('SELECT COUNT(*) AS total FROM monitors').get().total, 1);
      assert.equal(copy.prepare('SELECT COUNT(*) AS total FROM users').get().total, 1);
    } finally {
      copy.close();
      ctx.db.close();
    }
  });

  test('não sobrescreve uma cópia do mesmo segundo', () => {
    const ctx = createTestContext();
    const dir = join(workDir, 'copia-repetida');
    const now = () => new Date('2026-10-31T11:00:00.000Z');
    createBackup({ db: ctx.db, dir, keep: 7, now });

    assert.throws(() => createBackup({ db: ctx.db, dir, keep: 7, now }), /Já existe uma cópia/);
    ctx.db.close();
  });
});

describe('backup: rotação das cópias', () => {
  test('mantém só as cópias mais recentes e ignora arquivos que não são cópias', () => {
    const dir = join(workDir, 'rotacao');
    mkdirSync(dir, { recursive: true });
    const names = ['01', '02', '03', '04', '05'].map((day) => backupFileName(new Date(`2026-10-${day}T00:00:00Z`)));
    for (const name of names) writeFileSync(join(dir, name), '');
    writeFileSync(join(dir, 'anotacoes.txt'), 'não é cópia');

    const removed = pruneBackups(dir, 2);

    assert.equal(removed, 3);
    assert.deepEqual(readdirSync(dir).sort(), ['anotacoes.txt', names[3], names[4]].sort());
  });

  test('pasta inexistente não causa erro', () => {
    assert.equal(pruneBackups(join(workDir, 'nao-existe'), 7), 0);
  });
});

describe('backup: configuração do script', () => {
  test('usa valores padrão quando nada é definido', () => {
    assert.deepEqual(readBackupSettings({}), {
      databasePath: './data/vigia.db',
      dir: './backups',
      keep: 7,
    });
  });

  test('recusa BACKUP_KEEP inválido', () => {
    assert.throws(() => readBackupSettings({ BACKUP_KEEP: '0' }), /BACKUP_KEEP/);
    assert.throws(() => readBackupSettings({ BACKUP_KEEP: 'muitas' }), /BACKUP_KEEP/);
  });
});
