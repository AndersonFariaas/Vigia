import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/app.js';
import { createTestContext } from './helpers.js';

const noopCheck = async () => ({ status: 'ok' });
const passPublic = async () => {};

const SENHA = 'senha-forte-123';

/** Sobe uma instância do app com o banco de teste. Cada teste pode pedir opções próprias. */
function startApp(ctx, options = {}) {
  const app = createApp({
    repos: ctx.repos,
    auth: ctx.auth,
    checkMonitor: noopCheck,
    assertPublicUrl: passPublic,
    // Limite alto por padrão: os outros testes fazem várias entradas seguidas.
    loginLimit: { limit: 1000 },
    ...options,
  });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const cookieFrom = (response) => response.headers.get('set-cookie') ?? '';
const sessionValue = (setCookie) => setCookie.match(/vigia_sessao=([^;]*)/)?.[1] ?? '';

describe('autenticação: cadastro, entrada, sessão e saída', () => {
  let ctx;
  let server;
  let baseUrl;

  before(async () => {
    ctx = createTestContext();
    server = await startApp(ctx);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server.close();
    ctx.db.close();
  });

  const post = (path, body, headers = {}) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  test('cadastro cria a conta, devolve o usuário e define o cookie de sessão', async () => {
    const response = await post('/api/auth/cadastro', {
      nome: '  Ana Lima  ',
      email: 'Ana@Exemplo.com',
      password: SENHA,
      aceitouTermos: true,
    });

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      user: { id: 2, email: 'ana@exemplo.com', nome: 'Ana Lima' },
    });
    const setCookie = cookieFrom(response);
    assert.ok(setCookie.includes('HttpOnly'));
    assert.ok(setCookie.includes('SameSite=Strict'));
    assert.ok(sessionValue(setCookie).length > 40);
  });

  test('a senha nunca volta na resposta nem fica em claro no banco', async () => {
    const response = await post('/api/auth/cadastro', {
      nome: 'Bia Costa',
      email: 'bia@exemplo.com',
      password: SENHA,
      aceitouTermos: true,
    });
    assert.equal((await response.text()).includes(SENHA), false);

    const row = ctx.repos.users.findByEmail('bia@exemplo.com');
    assert.ok(row.password_hash.startsWith('scrypt$'));
    assert.equal(row.password_hash.includes(SENHA), false);
  });

  test('senha curta demais é recusada com 400 e mensagem em português', async () => {
    const response = await post('/api/auth/cadastro', {
      nome: 'Carla Souza',
      email: 'curta@exemplo.com',
      password: 'curta',
    });
    assert.equal(response.status, 400);
    assert.ok((await response.json()).details.some((message) => message.includes('pelo menos 10')));
  });

  test('cadastro sem nome é recusado com mensagem clara', async () => {
    const response = await post('/api/auth/cadastro', { email: 'sem-nome@exemplo.com', password: SENHA });
    assert.equal(response.status, 400);
    assert.ok((await response.json()).details.includes('Informe seu nome.'));
    assert.equal(ctx.repos.users.findByEmail('sem-nome@exemplo.com'), undefined);
  });

  test('cadastro com e-mail já existente responde de forma genérica', async () => {
    const response = await post('/api/auth/cadastro', {
      nome: 'Outra Ana',
      email: 'ana@exemplo.com',
      password: SENHA,
      aceitouTermos: true,
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, 'Não foi possível criar a conta com estes dados.');
  });

  test('sessão válida devolve o usuário em /sessao', async () => {
    const login = await post('/api/auth/entrar', { email: 'ana@exemplo.com', password: SENHA });
    const cookie = `vigia_sessao=${sessionValue(cookieFrom(login))}`;

    const response = await fetch(`${baseUrl}/api/auth/sessao`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      user: { id: 2, email: 'ana@exemplo.com', nome: 'Ana Lima' },
    });
  });

  test('senha errada e e-mail desconhecido recebem a mesma resposta', async () => {
    const wrongPassword = await post('/api/auth/entrar', { email: 'ana@exemplo.com', password: 'errada-123' });
    const unknownEmail = await post('/api/auth/entrar', { email: 'ninguem@exemplo.com', password: SENHA });

    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownEmail.status, 401);
    assert.deepEqual(await wrongPassword.json(), await unknownEmail.json());
  });

  test('conta da Fase 1, sem senha definida, não entra', async () => {
    const response = await post('/api/auth/entrar', { email: 'dono@exemplo.com', password: SENHA });
    assert.equal(response.status, 401);
  });

  test('sair encerra a sessão: o cookie antigo deixa de funcionar', async () => {
    const login = await post('/api/auth/entrar', { email: 'bia@exemplo.com', password: SENHA });
    const cookie = `vigia_sessao=${sessionValue(cookieFrom(login))}`;

    const logout = await fetch(`${baseUrl}/api/auth/sair`, { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(logout.status, 204);
    assert.ok(cookieFrom(logout).includes('vigia_sessao=;'));

    const after = await fetch(`${baseUrl}/api/auth/sessao`, { headers: { Cookie: cookie } });
    assert.equal(after.status, 401);
  });

  test('sessão expirada não vale mais, mesmo com o token certo', async () => {
    const { user, token } = await ctx.auth.register({ email: 'expirada@exemplo.com', password: SENHA });
    // Expira a sessão recém-criada diretamente no banco.
    ctx.db.prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?').run('2000-01-01T00:00:00.000Z', user.id);

    const response = await fetch(`${baseUrl}/api/auth/sessao`, {
      headers: { Cookie: `vigia_sessao=${token}` },
    });
    assert.equal(response.status, 401);
  });

  test('sem cookie, /sessao responde 401', async () => {
    const response = await fetch(`${baseUrl}/api/auth/sessao`);
    assert.equal(response.status, 401);
  });
});

describe('autenticação: cadastro fechado e limite de tentativas', () => {
  test('com CADASTRO_ABERTO=false, o cadastro responde 403', async () => {
    const ctx = createTestContext();
    const server = await startApp(ctx, { registrationOpen: false });
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/cadastro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nova@exemplo.com', password: SENHA }),
      });
      assert.equal(response.status, 403);
      assert.equal(ctx.repos.users.findByEmail('nova@exemplo.com'), undefined);
    } finally {
      server.close();
      ctx.db.close();
    }
  });

  test('depois de várias tentativas erradas, o IP leva 429', async () => {
    const ctx = createTestContext();
    const server = await startApp(ctx, { loginLimit: { limit: 3 } });
    const url = `http://127.0.0.1:${server.address().port}/api/auth/entrar`;
    try {
      const statuses = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'alguem@exemplo.com', password: 'tentativa-errada' }),
        });
        statuses.push(response.status);
      }
      assert.deepEqual(statuses, [401, 401, 401, 429]);
    } finally {
      server.close();
      ctx.db.close();
    }
  });

  test('exclusão de conta com senha atual errada também conta no limite', async () => {
    const ctx = createTestContext();
    const { token } = await ctx.auth.register({ nome: 'Dani Reis', email: 'dani@exemplo.com', password: SENHA, termosVersao: 'teste' });
    const server = await startApp(ctx, { loginLimit: { limit: 3 } });
    const url = `http://127.0.0.1:${server.address().port}/api/auth/conta`;
    try {
      const statuses = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const response = await fetch(url, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', Cookie: `vigia_sessao=${token}` },
          body: JSON.stringify({ senhaAtual: 'errada-123' }),
        });
        statuses.push(response.status);
      }
      assert.deepEqual(statuses, [400, 400, 400, 429]);
      assert.ok(ctx.repos.users.findByEmail('dani@exemplo.com'));
    } finally {
      server.close();
      ctx.db.close();
    }
  });
});
