import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'vigia_sessao';
export const SESSION_DAYS = 7;

const TOKEN_BYTES = 32;

/** Token aleatório de 256 bits. Vai no cookie e nunca é guardado em claro. */
export function createSessionToken() {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
