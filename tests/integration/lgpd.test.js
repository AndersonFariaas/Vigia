import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/app.js';
import { TERMS_VERSION } from '../../src/legal/termos.js';
import { createRetention } from '../../src/services/retention.js';
import { createTestContext } from './helpers.js';

const noopCheck = async () => ({ status: 'ok' });
const passPublic = async () => {};
const SENHA = 'senha-forte-123';

describe('LGPD: aceite dos termos no cadastro', () => {
  let ctx;
  let server;
  let baseUrl;

  before(async () => {
    ctx = createTestContext();
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

  const cadastro = (body) =>
    fetch(`${baseUrl}/api/auth/cadastro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  test('cadastro sem aceitar os termos é recusado e a conta não é criada', async () => {
    const response = await cadastro({ nome: 'Sem Aceite', email: 'sem-aceite@exemplo.com', password: SENHA });
    assert.equal(response.status, 400);
    assert.ok((await response.json()).details.includes('Você precisa aceitar os Termos de Uso e a Política de Privacidade.'));
    assert.equal(ctx.repos.users.findByEmail('sem-aceite@exemplo.com'), undefined);
  });

  test('cadastro com o aceite grava a versão dos termos e a data do aceite', async () => {
    const response = await cadastro({
      nome: 'Com Aceite',
      email: 'com-aceite@exemplo.com',
      password: SENHA,
      aceitouTermos: true,
    });
    assert.equal(response.status, 201);

    const row = ctx.db
      .prepare('SELECT termos_versao, termos_aceitos_em FROM users WHERE email = ?')
      .get('com-aceite@exemplo.com');
    assert.equal(row.termos_versao, TERMS_VERSION);
    assert.ok(!Number.isNaN(Date.parse(row.termos_aceitos_em)));
  });
});

describe('LGPD: retenção de 90 dias', () => {
  test('apaga snapshots e alertas mais antigos que 90 dias e mantém os recentes', () => {
    const ctx = createTestContext();
    const monitor = ctx.repos.monitors.create({
      userId: ctx.ownerId,
      url: 'https://exemplo.com/retencao',
      label: null,
      intervalMinutes: 60,
    });
    ctx.repos.snapshots.insert({ monitorId: monitor.id, contentHash: 'antigo', normalizedText: 'a', signals: {} });
    ctx.repos.snapshots.insert({ monitorId: monitor.id, contentHash: 'recente', normalizedText: 'b', signals: {} });
    const alertOld = ctx.repos.alerts.insert({
      monitorId: monitor.id,
      kind: 'alteracao_conteudo',
      severity: 'media',
      details: { addedCount: 0, removedCount: 0, added: [], removed: [] },
    });
    ctx.repos.alerts.insert({
      monitorId: monitor.id,
      kind: 'alteracao_conteudo',
      severity: 'media',
      details: { addedCount: 0, removedCount: 0, added: [], removed: [] },
    });

    ctx.db.prepare("UPDATE snapshots SET created_at = '2026-06-01T00:00:00.000Z' WHERE content_hash = 'antigo'").run();
    ctx.db.prepare("UPDATE snapshots SET created_at = '2026-10-20T00:00:00.000Z' WHERE content_hash = 'recente'").run();
    ctx.db.prepare('UPDATE alerts SET created_at = ? WHERE id = ?').run('2026-06-01T00:00:00.000Z', alertOld);

    const purge = createRetention({
      snapshots: ctx.repos.snapshots,
      alerts: ctx.repos.alerts,
      now: () => new Date('2026-10-31T00:00:00.000Z'),
    });
    const result = purge();

    assert.deepEqual(result, { removedSnapshots: 1, removedAlerts: 1 });
    assert.equal(ctx.count('snapshots'), 1);
    assert.equal(ctx.count('alerts'), 1);
    ctx.db.close();
  });
});

describe('LGPD: exclusão de conta', () => {
  let ctx;
  let server;
  let baseUrl;
  let cookie;

  before(async () => {
    ctx = createTestContext();
    const ana = await ctx.auth.register({ nome: 'Ana', email: 'excluir@exemplo.com', password: SENHA, termosVersao: TERMS_VERSION });
    cookie = `vigia_sessao=${ana.token}`;
    const monitor = ctx.repos.monitors.create({
      userId: ana.user.id,
      url: 'https://exemplo.com/excluir',
      label: 'Para excluir',
      intervalMinutes: 60,
    });
    ctx.repos.snapshots.insert({ monitorId: monitor.id, contentHash: 'x', normalizedText: 'x', signals: {} });

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

  const excluir = (body, headers = { Cookie: cookie }) =>
    fetch(`${baseUrl}/api/auth/conta`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  test('sem sessão, a exclusão responde 401', async () => {
    const response = await excluir({ senhaAtual: SENHA }, { Cookie: '' });
    assert.equal(response.status, 401);
  });

  test('senha atual errada impede a exclusão', async () => {
    const response = await excluir({ senhaAtual: 'errada-123' });
    assert.equal(response.status, 400);
    assert.ok(ctx.repos.users.findByEmail('excluir@exemplo.com'));
  });

  test('com a senha certa, apaga a conta, as páginas, o histórico e a sessão', async () => {
    const response = await excluir({ senhaAtual: SENHA });
    assert.equal(response.status, 204);
    assert.match(response.headers.get('set-cookie') ?? '', /vigia_sessao=;/);

    assert.equal(ctx.repos.users.findByEmail('excluir@exemplo.com'), undefined);
    assert.equal(ctx.count('monitors'), 0);
    assert.equal(ctx.count('snapshots'), 0);
    assert.equal(ctx.count('sessions'), 0);
  });
});
