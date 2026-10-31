import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/app.js';
import { createTestContext } from './helpers.js';

const noopCheck = async () => ({ status: 'ok' });
const passPublic = async () => {};
const SENHA = 'senha-forte-123';
const NOVA_SENHA = 'nova-senha-456';

describe('alterar a conta (nome, e-mail e senha)', () => {
  let ctx;
  let server;
  let baseUrl;
  let cookie;

  before(async () => {
    ctx = createTestContext();
    const ana = await ctx.auth.register({ nome: 'Ana Lima', email: 'ana@exemplo.com', password: SENHA });
    await ctx.auth.register({ nome: 'Bruno', email: 'bruno@exemplo.com', password: SENHA });
    cookie = `vigia_sessao=${ana.token}`;

    const app = createApp({
      repos: ctx.repos,
      auth: ctx.auth,
      checkMonitor: noopCheck,
      assertPublicUrl: passPublic,
      loginLimit: { limit: 1000 },
    });
    server = await new Promise((resolve) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server.close();
    ctx.db.close();
  });

  const patch = (body, headers = { Cookie: cookie }) =>
    fetch(`${baseUrl}/api/auth/conta`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  test('sem sessão, a alteração responde 401', async () => {
    const response = await patch({ nome: 'Outra' }, { Cookie: '' });
    assert.equal(response.status, 401);
  });

  test('trocar só o nome não pede a senha atual', async () => {
    const response = await patch({ nome: 'Ana Souza' });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).user, {
      id: 2,
      email: 'ana@exemplo.com',
      nome: 'Ana Souza',
    });
  });

  test('trocar o e-mail sem a senha atual é recusado', async () => {
    const response = await patch({ email: 'nova@exemplo.com' });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'Informe a senha atual para trocar e-mail ou senha.');
  });

  test('trocar o e-mail com senha atual errada é recusado', async () => {
    const response = await patch({ email: 'nova@exemplo.com', senhaAtual: 'errada-123' });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'Senha atual incorreta.');
  });

  test('e-mail de outra conta é recusado com 409', async () => {
    const response = await patch({ email: 'bruno@exemplo.com', senhaAtual: SENHA });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, 'Este e-mail já está em uso.');
  });

  test('trocar o e-mail com senha atual certa funciona e o login aceita o novo', async () => {
    const response = await patch({ email: 'nova@exemplo.com', senhaAtual: SENHA });
    assert.equal(response.status, 200);

    const session = await ctx.auth.login({ email: 'nova@exemplo.com', password: SENHA });
    assert.ok(session);
    assert.equal(await ctx.auth.login({ email: 'ana@exemplo.com', password: SENHA }), null);
  });

  test('nova senha curta demais é recusada', async () => {
    const response = await patch({ novaSenha: 'curta', senhaAtual: SENHA });
    assert.equal(response.status, 400);
  });

  test('trocar a senha exige a senha atual e depois o login usa a nova', async () => {
    const semAtual = await patch({ novaSenha: NOVA_SENHA });
    assert.equal(semAtual.status, 400);

    const response = await patch({ novaSenha: NOVA_SENHA, senhaAtual: SENHA });
    assert.equal(response.status, 200);

    assert.ok(await ctx.auth.login({ email: 'nova@exemplo.com', password: NOVA_SENHA }));
    assert.equal(await ctx.auth.login({ email: 'nova@exemplo.com', password: SENHA }), null);
  });

  test('a sessão continua válida depois de alterar a conta', async () => {
    const response = await fetch(`${baseUrl}/api/auth/sessao`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.email, 'nova@exemplo.com');
  });
});
