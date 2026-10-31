import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/app.js';
import { createTestContext } from './helpers.js';

const noopCheck = async () => ({ status: 'ok' });
const passPublic = async () => {};

const contexts = [];

async function start(options = {}) {
  const ctx = createTestContext();
  contexts.push(ctx);
  const app = createApp({
    repos: ctx.repos,
    auth: ctx.auth,
    checkMonitor: noopCheck,
    assertPublicUrl: passPublic,
    ...options,
  });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

// O log de requisição é gravado quando a resposta termina, um pouco depois do fetch voltar.
async function waitFor(check, attempts = 50) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return undefined;
}

after(() => {
  for (const ctx of contexts) ctx.db.close();
});

describe('limite geral da API', () => {
  test('passando do limite, a API responde 429 com mensagem em português', async () => {
    const { server, baseUrl } = await start({ apiLimit: { limit: 3 } });
    try {
      const statuses = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        statuses.push((await fetch(`${baseUrl}/api/health`)).status);
      }
      assert.deepEqual(statuses, [200, 200, 200, 429]);
      const blocked = await fetch(`${baseUrl}/api/health`);
      assert.match((await blocked.json()).error, /Muitas requisições/);
    } finally {
      server.close();
    }
  });

  test('com TRUST_PROXY ligado, cada IP real do X-Forwarded-For tem o próprio limite', async () => {
    const { server, baseUrl } = await start({ apiLimit: { limit: 1 }, trustProxy: true });
    const from = (ip) => fetch(`${baseUrl}/api/health`, { headers: { 'X-Forwarded-For': ip } });
    try {
      assert.equal((await from('203.0.113.10')).status, 200);
      assert.equal((await from('203.0.113.10')).status, 429);
      assert.equal((await from('203.0.113.20')).status, 200);
    } finally {
      server.close();
    }
  });

  test('sem TRUST_PROXY, o cabeçalho X-Forwarded-For é ignorado e o limite vale para o mesmo IP de conexão', async () => {
    const { server, baseUrl } = await start({ apiLimit: { limit: 1 } });
    const from = (ip) => fetch(`${baseUrl}/api/health`, { headers: { 'X-Forwarded-For': ip } });
    try {
      assert.equal((await from('203.0.113.10')).status, 200);
      assert.equal((await from('203.0.113.20')).status, 429);
    } finally {
      server.close();
    }
  });
});

describe('log de requisições', () => {
  test('cada chamada à API gera uma linha com método, caminho, status e duração, sem a query string', async () => {
    const lines = [];
    const { server, baseUrl } = await start({
      log: (level, message, fields) => lines.push({ level, message, ...fields }),
    });
    try {
      await fetch(`${baseUrl}/api/health?segredo=valor-sensivel`);

      const entry = await waitFor(() => lines.find((line) => line.message === 'requisicao'));
      assert.ok(entry, 'a requisição deveria ter sido registrada');
      assert.equal(entry.method, 'GET');
      assert.equal(entry.path, '/api/health');
      assert.equal(entry.status, 200);
      assert.equal(typeof entry.durationMs, 'number');
      assert.equal(JSON.stringify(lines).includes('valor-sensivel'), false);
    } finally {
      server.close();
    }
  });

  test('rotas montadas registram o caminho completo, não o caminho relativo ao roteador', async () => {
    const lines = [];
    const { server, baseUrl } = await start({
      log: (level, message, fields) => lines.push({ level, message, ...fields }),
    });
    try {
      await fetch(`${baseUrl}/api/monitors`);

      const entry = await waitFor(() => lines.find((line) => line.message === 'requisicao'));
      assert.equal(entry.path, '/api/monitors');
      assert.equal(entry.status, 401);
    } finally {
      server.close();
    }
  });
});
