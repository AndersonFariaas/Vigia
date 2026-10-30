import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/app.js';
import { DevinError } from '../../src/services/analyst/devinClient.js';
import { createTestContext } from './helpers.js';

const noopCheck = async () => ({ status: 'ok' });
const passPublic = async () => {};

/** Analista falso: registra os prompts recebidos e devolve sessões numeradas. */
function fakeAnalyst({ fail = null } = {}) {
  const prompts = [];
  return {
    prompts,
    async createAnalysisSession({ prompt }) {
      if (fail) throw fail;
      prompts.push(prompt);
      const sessionId = `devin-${prompts.length}`;
      return { sessionId, url: `https://app.devin.ai/sessions/${sessionId}` };
    },
  };
}

describe('análise de alertas com a Devin', () => {
  let ctx;
  let server;
  let baseUrl;
  let analyst;
  let monitorId;
  let alertId;
  let otherMonitorId;
  let otherAlertId;

  const startWith = (nextAnalyst) =>
    new Promise((resolve) => {
      const app = createApp({
        repos: ctx.repos,
        ownerId: ctx.ownerId,
        checkMonitor: noopCheck,
        assertPublicUrl: passPublic,
        analyst: nextAnalyst,
      });
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });

  before(async () => {
    ctx = createTestContext();
    analyst = fakeAnalyst();
    const monitor = ctx.repos.monitors.create({
      userId: ctx.ownerId,
      url: 'https://exemplo.com/precos',
      label: 'Preços',
      intervalMinutes: 60,
    });
    monitorId = monitor.id;
    alertId = ctx.repos.alerts.insert({
      monitorId,
      kind: 'alteracao_conteudo',
      severity: 'media',
      details: { addedCount: 1, removedCount: 1, added: ['Preço: R$ 39,90'], removed: ['Preço: R$ 49,90'] },
    });

    const other = ctx.repos.monitors.create({
      userId: ctx.ownerId,
      url: 'https://outro.com/',
      label: 'Outro',
      intervalMinutes: 60,
    });
    otherMonitorId = other.id;
    otherAlertId = ctx.repos.alerts.insert({
      monitorId: otherMonitorId,
      kind: 'alteracao_conteudo',
      severity: 'media',
      details: { addedCount: 1, removedCount: 0, added: ['x'], removed: [] },
    });

    server = await startWith(analyst);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server.close();
    ctx.db.close();
  });

  const analyze = (monitor, alert) =>
    fetch(`${baseUrl}/api/monitors/${monitor}/alerts/${alert}/analyze`, { method: 'POST' });

  test('cria a análise, retorna 201 com o link e grava o vínculo', async () => {
    const response = await analyze(monitorId, alertId);

    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.sessionUrl, 'https://app.devin.ai/sessions/devin-1');
    assert.equal(body.sessionId, 'devin-1');
    assert.equal(analyst.prompts.length, 1);
  });

  test('o prompt enviado contém o diff e o bloco de dados não confiáveis', () => {
    const [prompt] = analyst.prompts;
    assert.ok(prompt.includes('<dados_nao_confiaveis>'));
    assert.ok(prompt.includes('Preço: R$ 39,90'));
  });

  test('analisar de novo devolve a sessão existente sem cobrar outra vez', async () => {
    const response = await analyze(monitorId, alertId);

    assert.equal(response.status, 200);
    assert.equal((await response.json()).sessionId, 'devin-1');
    assert.equal(analyst.prompts.length, 1);
  });

  test('a lista de alertas mostra o link da análise', async () => {
    const response = await fetch(`${baseUrl}/api/monitors/${monitorId}/alerts`);
    const [alert] = await response.json();

    assert.equal(alert.analysis.sessionUrl, 'https://app.devin.ai/sessions/devin-1');
  });

  test('alerta de outro monitor retorna 404', async () => {
    const response = await analyze(monitorId, otherAlertId);
    assert.equal(response.status, 404);
  });

  test('alerta inexistente retorna 404', async () => {
    const response = await analyze(monitorId, 999999);
    assert.equal(response.status, 404);
  });

  test('ID de alerta inválido retorna 400', async () => {
    const response = await analyze(monitorId, 'abc');
    assert.equal(response.status, 400);
  });

  test('falha da Devin retorna 502 com mensagem amigável e sem stack', async () => {
    const failing = await startWith(
      fakeAnalyst({ fail: new DevinError('DEVIN_AUTH', 'A chave da Devin é inválida.') }),
    );
    const url = `http://127.0.0.1:${failing.address().port}`;
    const other = ctx.repos.alerts.insert({
      monitorId,
      kind: 'alteracao_conteudo',
      severity: 'baixa',
      details: { addedCount: 0, removedCount: 0, added: [], removed: [] },
    });

    try {
      const response = await fetch(`${url}/api/monitors/${monitorId}/alerts/${other}/analyze`, {
        method: 'POST',
      });
      assert.equal(response.status, 502);
      const body = await response.json();
      assert.equal(body.error, 'A chave da Devin é inválida.');
      assert.equal(body.stack, undefined);
    } finally {
      failing.close();
    }
  });

  test('falha da Devin não grava vínculo, então dá para tentar de novo', async () => {
    const failing = await startWith(fakeAnalyst({ fail: new DevinError('DEVIN_REDE', 'x') }));
    const url = `http://127.0.0.1:${failing.address().port}`;
    const pending = ctx.repos.alerts.insert({
      monitorId,
      kind: 'alteracao_conteudo',
      severity: 'baixa',
      details: { addedCount: 0, removedCount: 0, added: [], removed: [] },
    });

    try {
      await fetch(`${url}/api/monitors/${monitorId}/alerts/${pending}/analyze`, { method: 'POST' });
      assert.equal(ctx.repos.analyses.findByAlertId(pending), undefined);
    } finally {
      failing.close();
    }
  });
});
