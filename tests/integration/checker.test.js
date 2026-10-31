import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createChecker } from '../../src/services/checker.js';
import { createFirecrawlClient } from '../../src/services/scraper/firecrawlClient.js';
import { SsrfBlockedError } from '../../src/security/ssrfGuard.js';
import { createTestContext } from './helpers.js';

const PAGE = 'https://exemplo.com/precos';
const noWait = async () => {};

/** Scrape falso: cada chamada devolve o próximo markdown da fila (ou lança o erro). */
function queueScrape(items) {
  const queue = [...items];
  const scrape = async () => {
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return { markdown: next };
  };
  scrape.calls = () => items.length - queue.length;
  return scrape;
}

function setup({ scrape, assertPublicUrl = async () => {} } = {}) {
  const ctx = createTestContext();
  const monitor = ctx.repos.monitors.create({
    userId: ctx.ownerId,
    url: PAGE,
    label: 'Preços',
    intervalMinutes: 60,
  });
  const checkMonitor = createChecker({
    db: ctx.db,
    monitors: ctx.repos.monitors,
    snapshots: ctx.repos.snapshots,
    alerts: ctx.repos.alerts,
    scrape,
    assertPublicUrl,
    // Sem rede: o certificado real é lido só em testes próprios dos detectores.
    inspectCertificate: async () => null,
  });
  return { ...ctx, monitor, checkMonitor };
}

describe('checagem: comparação com o snapshot anterior', () => {
  test('primeira leitura vira referência e não gera alerta', async () => {
    const { checkMonitor, monitor, count, repos } = setup({
      scrape: queueScrape(['Preço: R$ 49,90']),
    });

    const result = await checkMonitor(monitor);

    assert.equal(result.status, 'referencia');
    assert.equal(count('snapshots'), 1);
    assert.equal(count('alerts'), 0);
    assert.equal(repos.monitors.findByIdForUser(monitor.user_id, monitor.id).last_status, 'referencia');
  });

  test('conteúdo igual registra "ok" e não alerta', async () => {
    const { checkMonitor, monitor, count } = setup({
      scrape: queueScrape(['Preço: R$ 49,90', 'Preço: R$ 49,90']),
    });

    await checkMonitor(monitor);
    const result = await checkMonitor(monitor);

    assert.equal(result.status, 'ok');
    assert.equal(count('alerts'), 0);
    assert.equal(count('snapshots'), 1);
  });

  test('mudança real cria snapshot novo e alerta pendente com o diff', async () => {
    const { checkMonitor, monitor, repos } = setup({
      scrape: queueScrape(['Preço: R$ 49,90', 'Preço: R$ 39,90']),
    });

    await checkMonitor(monitor);
    const result = await checkMonitor(monitor);

    assert.equal(result.status, 'alterado');
    const [alert] = repos.alerts.listForUser(monitor.user_id, monitor.id, 10);
    assert.equal(alert.send_status, 'pendente');
    assert.equal(alert.details.addedCount, 1);
    assert.equal(alert.details.removedCount, 1);
    assert.deepEqual(alert.details.added, ['Preço: R$ 39,90']);
  });

  test('ruído de data e horário é ignorado', async () => {
    const { checkMonitor, monitor, count } = setup({
      scrape: queueScrape([
        'Atualizado em 12/03/2026 às 10:00\nPreço: R$ 49,90',
        'Atualizado em 13/03/2026 às 15:42\nPreço: R$ 49,90',
      ]),
    });

    await checkMonitor(monitor);
    const result = await checkMonitor(monitor);

    assert.equal(result.status, 'ok');
    assert.equal(count('alerts'), 0);
  });

  test('guarda no máximo 50 snapshots por monitor', async () => {
    const pages = Array.from({ length: 55 }, (_, index) => `Versão ${index}`);
    const { checkMonitor, monitor, count } = setup({ scrape: queueScrape(pages) });

    for (let index = 0; index < pages.length; index += 1) {
      await checkMonitor(monitor);
    }

    assert.equal(count('snapshots'), 50);
  });
});

describe('checagem: segurança e erros', () => {
  test('bloqueio de SSRF não chama a Firecrawl e grava mensagem amigável', async () => {
    const scrape = queueScrape(['nunca usado']);
    const { checkMonitor, monitor, repos } = setup({
      scrape,
      assertPublicUrl: async () => {
        throw new SsrfBlockedError();
      },
    });

    const result = await checkMonitor(monitor);

    assert.equal(result.status, 'erro');
    assert.equal(scrape.calls(), 0);
    const stored = repos.monitors.findByIdForUser(monitor.user_id, monitor.id);
    assert.equal(stored.last_status, 'erro');
    assert.match(stored.last_error, /rede privada/);
  });

  test('retenta em 503 e registra sucesso no fim', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) return new Response('{}', { status: 503 });
      return new Response(JSON.stringify({ success: true, data: { markdown: 'Preço: 1' } }), {
        status: 200,
      });
    };
    const scrape = createFirecrawlClient({
      apiKey: 'k',
      baseUrl: 'https://api.firecrawl.dev',
      fetchImpl,
      wait: noWait,
    });
    const { checkMonitor, monitor } = setup({ scrape });

    const result = await checkMonitor(monitor);

    assert.equal(calls, 2);
    assert.equal(result.status, 'referencia');
  });

  test('não retenta em 402 e grava a mensagem de créditos', async () => {
    let calls = 0;
    const scrape = createFirecrawlClient({
      apiKey: 'k',
      baseUrl: 'https://api.firecrawl.dev',
      fetchImpl: async () => {
        calls += 1;
        return new Response('{}', { status: 402 });
      },
      wait: noWait,
    });
    const { checkMonitor, monitor, repos } = setup({ scrape });

    const result = await checkMonitor(monitor);

    assert.equal(calls, 1);
    assert.equal(result.status, 'erro');
    assert.match(repos.monitors.findByIdForUser(monitor.user_id, monitor.id).last_error, /créditos/);
  });

  test('erro inesperado grava mensagem genérica, nunca a mensagem crua', async () => {
    const { checkMonitor, monitor, repos } = setup({
      scrape: queueScrape([new Error('stack interna: senha=abc123')]),
    });

    await checkMonitor(monitor);

    const stored = repos.monitors.findByIdForUser(monitor.user_id, monitor.id).last_error;
    assert.equal(stored, 'Erro inesperado ao verificar a página.');
  });

  test('página sem conteúdo legível vira erro', async () => {
    const { checkMonitor, monitor, repos } = setup({ scrape: queueScrape(['   \n  ']) });

    const result = await checkMonitor(monitor);

    assert.equal(result.status, 'erro');
    assert.match(repos.monitors.findByIdForUser(monitor.user_id, monitor.id).last_error, /conteúdo legível/);
  });

  test('segunda checagem simultânea do mesmo monitor é recusada', async () => {
    let release;
    const slowScrape = () =>
      new Promise((resolve) => {
        release = () => resolve({ markdown: 'Preço: 1' });
      });
    const { checkMonitor, monitor } = setup({ scrape: slowScrape });

    const first = checkMonitor(monitor);
    const second = await checkMonitor(monitor);
    release();
    await first;

    assert.equal(second.status, 'em_andamento');
  });

  test('registra última checagem e limpa o erro anterior ao dar certo', async () => {
    const { checkMonitor, monitor, repos } = setup({
      scrape: queueScrape([new Error('falha'), 'Preço: 1']),
    });

    await checkMonitor(monitor);
    assert.notEqual(repos.monitors.findByIdForUser(monitor.user_id, monitor.id).last_error, null);

    await checkMonitor(monitor);
    const stored = repos.monitors.findByIdForUser(monitor.user_id, monitor.id);
    assert.equal(stored.last_error, null);
    assert.notEqual(stored.last_checked_at, null);
  });
});
