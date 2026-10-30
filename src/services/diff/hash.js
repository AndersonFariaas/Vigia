import { createHash } from 'node:crypto';

/** SHA-256 em hexadecimal (64 caracteres). Determinístico para o mesmo texto. */
export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
