import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createChecker } from '../../src/services/checker.js';
import { normalizeText } from '../../src/services/scraper/normalize.js';
import { sha256 } from '../../src/services/diff/hash.js';
import { createTestContext } from './helpers.js';

const fixture = (path) => readFileSync(new URL(`../fixtures/${path}`, import.meta.url), 'utf8');
const TEXTO = 'Conteúdo estável da página de teste.';
const page = (html, markdown = TEXTO) => ({ markdown, html });

/** Um monitor com uma fila de leituras: cada checagem consome a próxima. */
function setupPage(url, reads) {
  const ctx = createTestContext();
  const monitor = ctx.repos.monitors.create({ userId: ctx.ownerId, url, label: 'Teste', intervalMinutes: 60 });
  const queue = [...reads];
  const checkMonitor = createChecker({
    db: ctx.db,
    monitors: ctx.repos.monitors,
    snapshots: ctx.repos.snapshots,
    alerts: ctx.repos.alerts,
    scrape: async () => queue.shift(),
    assertPublicUrl: async () => {},
    inspectCertificate: async () => null,
  });
  return { ...ctx, monitor, checkMonitor };
}

const alertsOf = (ctx) => ctx.repos.alerts.listForUser(ctx.ownerId, ctx.monitor.id, 100);

describe('detectores na checagem', () => {
  test('página de golpe: alertas de risco alta já na primeira leitura', async () => {
    const ctx = setupPage('https://bradesc0.com.br/login', [page(fixture('phishing/bradesco-falso.html'))]);

    const result = await ctx.checkMonitor(ctx.monitor);
    const alerts = alertsOf(ctx);

    assert.equal(result.status, 'alterado');
    assert.ok(alerts.some((a) => a.kind === 'risco' && a.severity === 'alta' && a.details.chave.startsWith('senha-externa:')));
    assert.ok(alerts.some((a) => a.details.chave.startsWith('dominio-parecido:')));
    assert.equal(alerts.some((a) => a.kind === 'alteracao_conteudo'), false);
  });

  test('página oficial: a primeira leitura vira referência sem alerta', async () => {
    const ctx = setupPage('https://internet.caixa.gov.br/login', [page(fixture('normais/caixa-login-oficial.html'))]);

    const result = await ctx.checkMonitor(ctx.monitor);

    assert.equal(result.status, 'referencia');
    assert.equal(alertsOf(ctx).length, 0);
  });

  test('script novo depois da referência gera alerta baixo, e não se repete', async () => {
    const base = fixture('normais/loja-produtos.html');
    const withAd = base.replace('</head>', '<script src="https://anuncios-exemplo.net/a.js"></script></head>');
    const ctx = setupPage('https://loja-exemplo.com.br/produtos', [page(base), page(withAd), page(withAd)]);

    await ctx.checkMonitor(ctx.monitor);
    const changed = await ctx.checkMonitor(ctx.monitor);
    const repeated = await ctx.checkMonitor(ctx.monitor);
    const alerts = alertsOf(ctx);

    assert.equal(changed.status, 'alterado');
    assert.equal(repeated.status, 'ok');
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].severity, 'baixa');
    assert.equal(alerts[0].details.chave, 'script:anuncios-exemplo.net');
  });

  test('formulário de senha que aparece numa página de notícias gera alerta média', async () => {
    const base = fixture('normais/noticias-artigo.html');
    const withPassword = base.replace('</form>', '<input type="password" name="s"></form>');
    const ctx = setupPage('https://noticias-exemplo.org/artigo', [page(base), page(withPassword)]);

    await ctx.checkMonitor(ctx.monitor);
    await ctx.checkMonitor(ctx.monitor);
    const alerts = alertsOf(ctx);

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].severity, 'media');
    assert.ok(alerts[0].details.chave.startsWith('formulario-senha:'));
  });

  test('leitura anterior à Fase 2 (sem riscos guardados) não dispara alerta de risco', async () => {
    const ctx = setupPage('https://bradesc0.com.br/login', [page(fixture('phishing/bradesco-falso.html'))]);
    // Snapshot no formato antigo: texto igual e sem a lista de riscos.
    ctx.repos.snapshots.insert({
      monitorId: ctx.monitor.id,
      contentHash: sha256(normalizeText(TEXTO)),
      normalizedText: normalizeText(TEXTO),
      signals: {},
    });

    const result = await ctx.checkMonitor(ctx.monitor);

    assert.equal(result.status, 'ok');
    assert.equal(alertsOf(ctx).length, 0);
  });

  test('medição: falsos positivos nas páginas normais e detecção nas páginas de golpe', async (t) => {
    const normais = [
      ['https://internet.caixa.gov.br/login', 'normais/caixa-login-oficial.html'],
      ['https://loja-exemplo.com.br/produtos', 'normais/loja-produtos.html'],
      ['https://www.nubank.com.br/entrar', 'normais/nubank-login-oficial.html'],
      ['https://noticias-exemplo.org/artigo', 'normais/noticias-artigo.html'],
    ];
    const golpes = [
      ['https://bradesc0.com.br/login', 'phishing/bradesco-falso.html'],
      ['https://nubanc.com.br/entrar', 'phishing/nubanc-login-rastreado.html'],
      ['https://paypa1.com/', 'phishing/paypa1-sem-formulario.html'],
    ];

    let falsosPositivos = 0;
    for (const [url, path] of normais) {
      const ctx = setupPage(url, [page(fixture(path))]);
      await ctx.checkMonitor(ctx.monitor);
      falsosPositivos += alertsOf(ctx).filter((a) => ['alta', 'media'].includes(a.severity)).length;
    }

    let detectados = 0;
    for (const [url, path] of golpes) {
      const ctx = setupPage(url, [page(fixture(path))]);
      await ctx.checkMonitor(ctx.monitor);
      if (alertsOf(ctx).some((a) => a.severity === 'alta')) detectados += 1;
    }

    t.diagnostic(`Falsos positivos (alerta média ou alta): ${falsosPositivos} em ${normais.length} páginas normais.`);
    t.diagnostic(`Detecção: ${detectados} de ${golpes.length} páginas de golpe com alerta alta.`);
    assert.equal(falsosPositivos, 0);
    assert.equal(detectados, golpes.length);
  });
});
