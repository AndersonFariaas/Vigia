import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, renderAlertEmail } from '../../src/services/notifier/dispatcher.js';
import { createFirecrawlClient, ScrapeError } from '../../src/services/scraper/firecrawlClient.js';

describe('escapeHtml e e-mail de alerta', () => {
  test('escapa os cinco caracteres perigosos', () => {
    assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  });

  test('conteúdo malicioso da página não vira tag no e-mail', () => {
    const email = renderAlertEmail({
      monitor_label: '<img src=x onerror=alert(1)>',
      monitor_url: 'https://exemplo.com/?q="><script>alert(1)</script>',
      details: {
        addedCount: 1,
        removedCount: 0,
        added: ['<script>alert("oi")</script>'],
        removed: [],
      },
    });

    assert.equal(email.html.includes('<script'), false);
    assert.equal(email.html.includes('<img'), false);
    assert.ok(email.html.includes('&lt;script&gt;'));
  });

  test('assunto não recebe quebra de linha', () => {
    const email = renderAlertEmail({
      monitor_label: 'linha\nquebrada',
      monitor_url: 'https://exemplo.com',
      details: { addedCount: 0, removedCount: 0, added: [], removed: [] },
    });
    assert.equal(email.subject.includes('\n'), false);
  });

  test('usa a URL quando o monitor não tem nome', () => {
    const email = renderAlertEmail({
      monitor_label: null,
      monitor_url: 'https://exemplo.com/',
      details: { addedCount: 0, removedCount: 0, added: [], removed: [] },
    });
    assert.ok(email.subject.includes('https://exemplo.com/'));
  });
});

describe('createFirecrawlClient', () => {
  const noWait = async () => {};
  const jsonResponse = (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  test('envia POST para /v1/scrape com markdown e html', async () => {
    let captured;
    const fetchImpl = async (url, init) => {
      captured = { url, init, body: JSON.parse(init.body) };
      return jsonResponse(200, { success: true, data: { markdown: 'oi' } });
    };
    const scrape = createFirecrawlClient({
      apiKey: 'fc-teste',
      baseUrl: 'https://api.firecrawl.dev',
      fetchImpl,
      wait: noWait,
    });

    const result = await scrape('https://exemplo.com');

    assert.equal(result.markdown, 'oi');
    assert.equal(captured.url, 'https://api.firecrawl.dev/v1/scrape');
    assert.equal(captured.init.method, 'POST');
    assert.equal(captured.init.headers.Authorization, 'Bearer fc-teste');
    assert.deepEqual(captured.body.formats, ['markdown', 'rawHtml']);
    // Sem maxAge 0 a Firecrawl devolve cache e mudanças reais passam como "ok".
    assert.equal(captured.body.maxAge, 0);
  });

  test('retenta em 503 e tem sucesso na segunda tentativa', async () => {
    let calls = 0;
    const waits = [];
    const fetchImpl = async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse(503, {})
        : jsonResponse(200, { success: true, data: { markdown: 'ok' } });
    };
    const scrape = createFirecrawlClient({
      apiKey: 'k',
      baseUrl: 'https://api.firecrawl.dev',
      fetchImpl,
      wait: async (ms) => waits.push(ms),
    });

    const result = await scrape('https://exemplo.com');

    assert.equal(calls, 2);
    assert.deepEqual(waits, [2000]);
    assert.equal(result.markdown, 'ok');
  });

  test('não retenta em 402 (sem créditos)', async () => {
    let calls = 0;
    const scrape = createFirecrawlClient({
      apiKey: 'k',
      baseUrl: 'https://api.firecrawl.dev',
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse(402, { error: 'payment required' });
      },
      wait: noWait,
    });

    await assert.rejects(scrape('https://exemplo.com'), (error) => {
      assert.ok(error instanceof ScrapeError);
      assert.equal(error.code, 'FIRECRAWL_SEM_CREDITO');
      assert.equal(error.retryable, false);
      return true;
    });
    assert.equal(calls, 1);
  });

  test('desiste depois de 3 tentativas em erro de rede', async () => {
    let calls = 0;
    const scrape = createFirecrawlClient({
      apiKey: 'k',
      baseUrl: 'https://api.firecrawl.dev',
      fetchImpl: async () => {
        calls += 1;
        throw new TypeError('fetch failed');
      },
      wait: noWait,
    });

    await assert.rejects(scrape('https://exemplo.com'), { code: 'FIRECRAWL_REDE' });
    assert.equal(calls, 3);
  });

  test('timeout é tratado como erro retentável', async () => {
    const scrape = createFirecrawlClient({
      apiKey: 'k',
      baseUrl: 'https://api.firecrawl.dev',
      timeoutMs: 10,
      retryDelaysMs: [],
      fetchImpl: (url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const abort = new Error('aborted');
            abort.name = 'AbortError';
            reject(abort);
          });
        }),
      wait: noWait,
    });

    await assert.rejects(scrape('https://exemplo.com'), { code: 'FIRECRAWL_TIMEOUT' });
  });

  test('o erro não repassa a resposta crua da API', async () => {
    const scrape = createFirecrawlClient({
      apiKey: 'k',
      baseUrl: 'https://api.firecrawl.dev',
      fetchImpl: async () => jsonResponse(400, { detail: 'segredo interno da conta 123' }),
      wait: noWait,
    });

    await assert.rejects(scrape('https://exemplo.com'), (error) => {
      assert.equal(error.message.includes('segredo'), false);
      return true;
    });
  });
});
