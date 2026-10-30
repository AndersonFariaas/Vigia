import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/app.js';
import { MAX_MONITORS_PER_USER } from '../../src/routes/monitors.routes.js';
import { createDispatcher } from '../../src/services/notifier/dispatcher.js';
import { createTestContext } from './helpers.js';

const noopCheck = async () => ({ status: 'ok' });
const passPublic = async () => {};
const SENHA = 'senha-forte-123';

describe('isolamento entre contas', () => {
  let ctx;
  let server;
  let baseUrl;
  let cookieA;
  let cookieB;
  let monitorA;

  before(async () => {
    ctx = createTestContext();
    const alice = await ctx.auth.register({ email: 'alice@exemplo.com', password: SENHA });
    const bruno = await ctx.auth.register({ email: 'bruno@exemplo.com', password: SENHA });
    cookieA = `vigia_sessao=${alice.token}`;
    cookieB = `vigia_sessao=${bruno.token}`;

    monitorA = ctx.repos.monitors.create({
      userId: alice.user.id,
      url: 'https://exemplo.com/a',
      label: 'Da Alice',
      intervalMinutes: 60,
    });
    ctx.repos.alerts.insert({
      monitorId: monitorA.id,
      kind: 'alteracao_conteudo',
      severity: 'media',
      details: { addedCount: 1, removedCount: 0, added: ['x'], removed: [] },
    });

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

  const request = (path, cookie, options = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Cookie: cookie, ...options.headers },
    });

  test('cada conta vê só os próprios monitores na lista', async () => {
    const listA = await (await request('/api/monitors', cookieA)).json();
    const listB = await (await request('/api/monitors', cookieB)).json();

    assert.equal(listA.length, 1);
    assert.equal(listB.length, 0);
  });

  test('a outra conta não consegue ler alertas, snapshots nem checar o monitor', async () => {
    const alerts = await request(`/api/monitors/${monitorA.id}/alerts`, cookieB);
    const snapshots = await request(`/api/monitors/${monitorA.id}/snapshots`, cookieB);
    const check = await request(`/api/monitors/${monitorA.id}/check`, cookieB, { method: 'POST' });

    assert.equal(alerts.status, 404);
    assert.equal(snapshots.status, 404);
    assert.equal(check.status, 404);
  });

  test('a outra conta não consegue remover o monitor, e ele continua existindo', async () => {
    const removed = await request(`/api/monitors/${monitorA.id}`, cookieB, { method: 'DELETE' });
    assert.equal(removed.status, 404);
    assert.ok(ctx.repos.monitors.findByIdForUser(monitorA.user_id, monitorA.id));
  });

  test('o dono continua tendo acesso normal ao próprio monitor', async () => {
    const alerts = await request(`/api/monitors/${monitorA.id}/alerts`, cookieA);
    assert.equal(alerts.status, 200);
    assert.equal((await alerts.json()).length, 1);
  });

  test('limite de páginas por conta: a partir de 20, o cadastro responde 409', async () => {
    const bruno = ctx.repos.users.findByEmail('bruno@exemplo.com');
    for (let index = 0; index < MAX_MONITORS_PER_USER; index += 1) {
      ctx.repos.monitors.create({
        userId: bruno.id,
        url: `https://exemplo.com/lote-${index}`,
        label: null,
        intervalMinutes: 60,
      });
    }

    const response = await request('/api/monitors', cookieB, {
      method: 'POST',
      body: JSON.stringify({ url: 'https://exemplo.com/extra' }),
    });
    assert.equal(response.status, 409);
    assert.ok((await response.json()).error.includes(String(MAX_MONITORS_PER_USER)));
  });
});

describe('alertas vão para o e-mail do dono do monitor', () => {
  test('cada alerta é enviado para a conta dona do monitor', async () => {
    const ctx = createTestContext();
    const alice = await ctx.auth.register({ email: 'alice@exemplo.com', password: SENHA });
    const bruno = await ctx.auth.register({ email: 'bruno@exemplo.com', password: SENHA });

    const monitorAlice = ctx.repos.monitors.create({
      userId: alice.user.id,
      url: 'https://exemplo.com/alice',
      label: 'Alice',
      intervalMinutes: 60,
    });
    const monitorBruno = ctx.repos.monitors.create({
      userId: bruno.user.id,
      url: 'https://exemplo.com/bruno',
      label: 'Bruno',
      intervalMinutes: 60,
    });
    for (const monitor of [monitorAlice, monitorBruno]) {
      ctx.repos.alerts.insert({
        monitorId: monitor.id,
        kind: 'alteracao_conteudo',
        severity: 'media',
        details: { addedCount: 1, removedCount: 0, added: ['x'], removed: [] },
      });
    }

    const destinations = [];
    const dispatchPending = createDispatcher({
      alerts: ctx.repos.alerts,
      sendEmail: async ({ to }) => destinations.push(to),
    });
    await dispatchPending();

    assert.deepEqual(destinations.sort(), ['alice@exemplo.com', 'bruno@exemplo.com']);
    ctx.db.close();
  });
});
