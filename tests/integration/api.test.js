import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/app.js';
import { assertPublicHost } from '../../src/security/ssrfGuard.js';
import { createTestContext } from './helpers.js';

const noopCheck = async () => ({ status: 'ok' });
// DNS simulado: o teste roda sem rede, mas a regra de SSRF é a de verdade.
const fakeLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const assertPublicUrl = (url) =>
  assertPublicHost(new URL(url).hostname, { lookup: fakeLookup });

describe('API /api/monitors', () => {
  let ctx;
  let server;
  let baseUrl;

  before(async () => {
    ctx = createTestContext();
    const app = createApp({
      repos: ctx.repos,
      ownerId: ctx.ownerId,
      checkMonitor: noopCheck,
      assertPublicUrl,
    });
    server = await new Promise((resolve) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(() => {
    server.close();
    ctx.db.close();
  });

  const request = (path, options = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });

  const postMonitor = (body) =>
    request('/api/monitors', { method: 'POST', body: JSON.stringify(body) });

  test('GET /api/health responde ok', async () => {
    const response = await request('/api/health');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  });

  test('helmet está ativo e x-powered-by está desligado', async () => {
    const response = await request('/api/health');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.has('x-powered-by'), false);
  });

  test('SSRF: IP interno retorna 400 JSON', async () => {
    const response = await postMonitor({ url: 'http://127.0.0.1/admin' });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(typeof body.error, 'string');
    assert.equal(body.stack, undefined);
  });

  test('file:// retorna 400', async () => {
    const response = await postMonitor({ url: 'file:///etc/passwd' });
    assert.equal(response.status, 400);
  });

  test('intervalo abaixo de 15 minutos retorna 400', async () => {
    const response = await postMonitor({ url: 'https://exemplo.com', intervalMinutes: 5 });
    assert.equal(response.status, 400);
  });

  test('intervalo acima de 1440 minutos retorna 400', async () => {
    const response = await postMonitor({ url: 'https://exemplo.com', intervalMinutes: 2000 });
    assert.equal(response.status, 400);
  });

  test('JSON malformado retorna 400 sem stack trace', async () => {
    const response = await request('/api/monitors', {
      method: 'POST',
      body: '{"url": ',
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.deepEqual(body, { error: 'JSON malformado.' });
  });

  test('corpo acima de 10kb retorna 413', async () => {
    const response = await postMonitor({ url: 'https://exemplo.com', label: 'x'.repeat(20_000) });
    assert.equal(response.status, 413);
  });

  test('rota inexistente de API retorna 404 JSON', async () => {
    const response = await request('/api/nao-existe');
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Rota não encontrada.' });
  });

  test('ID inválido retorna 400', async () => {
    const response = await request('/api/monitors/abc/snapshots');
    assert.equal(response.status, 400);
  });

  test('cria monitor válido com 201 e rejeita duplicata com 409', async () => {
    const created = await postMonitor({ url: 'https://exemplo.com/precos', intervalMinutes: 30 });
    assert.equal(created.status, 201);
    const monitor = await created.json();
    assert.equal(monitor.url, 'https://exemplo.com/precos');
    assert.equal(monitor.intervalMinutes, 30);

    const duplicate = await postMonitor({ url: 'https://exemplo.com/precos' });
    assert.equal(duplicate.status, 409);
  });

  test('campos desconhecidos são recusados', async () => {
    const response = await postMonitor({ url: 'https://exemplo.com/x', userId: 99 });
    assert.equal(response.status, 400);
  });

  test('checagem manual, histórico e remoção em cascata', async () => {
    const created = await postMonitor({ url: 'https://exemplo.com/remover' });
    const { id } = await created.json();

    const check = await request(`/api/monitors/${id}/check`, { method: 'POST' });
    assert.equal(check.status, 200);

    const snapshots = await request(`/api/monitors/${id}/snapshots`);
    assert.equal(snapshots.status, 200);

    const alerts = await request(`/api/monitors/${id}/alerts`);
    assert.equal(alerts.status, 200);

    const removed = await request(`/api/monitors/${id}`, { method: 'DELETE' });
    assert.equal(removed.status, 204);

    const gone = await request(`/api/monitors/${id}/alerts`);
    assert.equal(gone.status, 404);
  });

  test('monitor inexistente retorna 404 em vez de 500', async () => {
    const response = await request('/api/monitors/999999/check', { method: 'POST' });
    assert.equal(response.status, 404);
  });

  test('lista não expõe user_id', async () => {
    const response = await request('/api/monitors');
    const list = await response.json();
    assert.ok(list.length >= 1);
    assert.equal('user_id' in list[0], false);
  });
});
