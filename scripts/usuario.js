// Cria uma conta ou define a senha de uma conta existente (ex.: a conta da Fase 1, sem senha).
// Uso: npm run usuario -- email@exemplo.com
import { existsSync } from 'node:fs';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { z } from 'zod';
import { openDatabase } from '../src/db/index.js';
import { applyMigrations } from '../src/db/migrate.js';
import { createUsersRepository } from '../src/db/repositories/users.js';
import { hashPassword } from '../src/security/passwords.js';

const MIN_PASSWORD_LENGTH = 10;
const DEFAULT_DATABASE_PATH = './data/vigia.db';

const emailSchema = z.email();

function fail(message) {
  console.error(`[vigia] ${message}`);
  process.exit(1);
}

async function askPassword() {
  // A senha aparece enquanto é digitada. Rode num terminal sem outras pessoas olhando.
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await rl.question(`Senha (mínimo ${MIN_PASSWORD_LENGTH} caracteres): `);
  } finally {
    rl.close();
  }
}

async function main() {
  if (existsSync('.env')) process.loadEnvFile('.env');

  const email = (process.argv[2] ?? '').trim().toLowerCase();
  if (!emailSchema.safeParse(email).success) fail('Informe um e-mail válido: npm run usuario -- email@exemplo.com');

  const password = await askPassword();
  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(`A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }

  const db = openDatabase(process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH);
  try {
    applyMigrations(db);
    const users = createUsersRepository(db);
    const passwordHash = await hashPassword(password);

    const existing = users.findByEmail(email);
    if (existing) {
      users.setPassword(existing.id, passwordHash);
      console.log('[vigia] Senha definida para a conta existente.');
    } else {
      users.create({ email, passwordHash });
      console.log('[vigia] Conta criada.');
    }
  } finally {
    db.close();
  }
}

main().catch((error) => fail(`Falha: ${error.name}`));
