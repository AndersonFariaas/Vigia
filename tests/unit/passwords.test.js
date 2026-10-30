import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../../src/security/passwords.js';
import { createSessionToken, hashSessionToken } from '../../src/security/sessionToken.js';

describe('senhas (scrypt)', () => {
  test('o hash não guarda a senha e segue o formato com os parâmetros', async () => {
    const hash = await hashPassword('senha-secreta-123');
    assert.ok(hash.startsWith('scrypt$16384$8$1$'));
    assert.equal(hash.includes('senha-secreta-123'), false);
  });

  test('a senha certa é aceita e a errada é recusada', async () => {
    const hash = await hashPassword('senha-secreta-123');
    assert.equal(await verifyPassword('senha-secreta-123', hash), true);
    assert.equal(await verifyPassword('senha-secreta-124', hash), false);
  });

  test('o mesmo texto gera hashes diferentes (sal aleatório)', async () => {
    const first = await hashPassword('mesma-senha-aqui');
    const second = await hashPassword('mesma-senha-aqui');
    assert.notEqual(first, second);
  });

  test('hash ausente ou mal formado é sempre "senha errada", sem lançar', async () => {
    assert.equal(await verifyPassword('qualquer', null), false);
    assert.equal(await verifyPassword('qualquer', undefined), false);
    assert.equal(await verifyPassword('qualquer', 'não-é-um-hash'), false);
    assert.equal(await verifyPassword('qualquer', 'scrypt$x$8$1$abc$def'), false);
  });
});

describe('token de sessão', () => {
  test('tokens são aleatórios e longos', () => {
    const first = createSessionToken();
    const second = createSessionToken();
    assert.notEqual(first, second);
    assert.ok(first.length >= 43);
  });

  test('o banco recebe só o hash do token, que é determinístico', () => {
    const token = createSessionToken();
    assert.equal(hashSessionToken(token), hashSessionToken(token));
    assert.notEqual(hashSessionToken(token), token);
    assert.equal(hashSessionToken(token).length, 64);
  });
});
