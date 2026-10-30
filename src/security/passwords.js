import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

// Custo do scrypt (memória e CPU). N = 2^14 é um equilíbrio razoável para um servidor pequeno.
// Os parâmetros ficam gravados no próprio hash, então dá para aumentá-los no futuro sem quebrar contas antigas.
const COST = Object.freeze({ N: 16384, r: 8, p: 1 });
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const FORMAT = 'scrypt';

function deriveKey(password, salt, { N, r, p }) {
  return scrypt(password, salt, KEY_LENGTH, { N, r, p });
}

/** Formato: scrypt$N$r$p$sal$chave (base64). Não tem "$" no base64, então o split é seguro. */
export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt, COST);
  return [FORMAT, COST.N, COST.r, COST.p, salt.toString('base64'), key.toString('base64')].join('$');
}

function parseStoredHash(stored) {
  if (typeof stored !== 'string') return null;

  const [format, n, r, p, salt, key] = stored.split('$');
  if (format !== FORMAT || !salt || !key) return null;

  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (![cost.N, cost.r, cost.p].every(Number.isInteger)) return null;

  return { cost, salt: Buffer.from(salt, 'base64'), key: Buffer.from(key, 'base64') };
}

/** Compara em tempo constante. Hash mal formado ou ausente é sempre "senha errada". */
export async function verifyPassword(password, stored) {
  const parsed = parseStoredHash(stored);
  if (!parsed) return false;

  const key = await deriveKey(password, parsed.salt, parsed.cost);
  return key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
}
