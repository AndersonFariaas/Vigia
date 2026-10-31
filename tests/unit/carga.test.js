import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { percentile, runLoadTest, summarize } from '../../scripts/carga.js';

describe('teste de carga: estatísticas', () => {
  test('percentil usa o posto mais próximo', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    assert.equal(percentile(values, 50), 50);
    assert.equal(percentile(values, 95), 100);
    assert.equal(percentile(values, 1), 10);
  });

  test('lista vazia não quebra', () => {
    assert.equal(percentile([], 95), 0);
    assert.deepEqual(summarize([]), { total: 0, errors: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  });

  test('resumo conta erros e ordena as latências', () => {
    const summary = summarize([
      { ms: 30, ok: true },
      { ms: 10, ok: true },
      { ms: 90, ok: false },
    ]);
    assert.equal(summary.total, 3);
    assert.equal(summary.errors, 1);
    assert.equal(summary.p50, 30);
    assert.equal(summary.max, 90);
  });
});

describe('teste de carga: execução', () => {
  test('dispara exatamente o total pedido, com a concorrência indicada', async () => {
    let inFlight = 0;
    let peak = 0;
    let calls = 0;
    const request = async () => {
      calls += 1;
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { ms: 5, ok: true };
    };

    const result = await runLoadTest({ url: 'http://exemplo.test/', total: 20, concurrency: 4, request });

    assert.equal(calls, 20);
    assert.equal(result.total, 20);
    assert.equal(result.errors, 0);
    assert.ok(peak <= 4, `pico de ${peak} conexões simultâneas, acima do pedido`);
    assert.ok(result.requestsPerSecond > 0);
  });
});
