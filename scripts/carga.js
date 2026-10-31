// Teste de carga simples, sem dependências: `npm run carga -- --url http://127.0.0.1:3000/api/health`.
// Dispara `--total` requisições com `--concurrency` conexões ao mesmo tempo e mostra latências.
// Use em um ambiente de teste, nunca contra um servidor que não é seu.
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const DEFAULT_TOTAL = 200;
const DEFAULT_CONCURRENCY = 10;

/** Percentil de uma lista já ordenada (método do posto mais próximo). */
export function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedValues.length);
  return sortedValues[Math.min(sortedValues.length, Math.max(1, rank)) - 1];
}

/** Resume as amostras. Uma amostra é `{ ms, ok }`; `ok` é false para falha de rede ou status 5xx. */
export function summarize(samples) {
  const durations = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  return {
    total: samples.length,
    errors: samples.filter((sample) => !sample.ok).length,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    max: durations.at(-1) ?? 0,
  };
}

async function timedRequest(url) {
  const started = performance.now();
  try {
    const response = await fetch(url);
    await response.arrayBuffer();
    return { ms: performance.now() - started, ok: response.status < 500 };
  } catch {
    return { ms: performance.now() - started, ok: false };
  }
}

/**
 * Roda as requisições com `concurrency` trabalhadores. `request` é injetável,
 * então os testes rodam sem rede.
 */
export async function runLoadTest({ url, total, concurrency, request = timedRequest }) {
  const samples = [];
  let issued = 0;
  const started = performance.now();

  async function worker() {
    while (issued < total) {
      issued += 1;
      samples.push(await request(url));
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  const seconds = (performance.now() - started) / 1000;
  return { ...summarize(samples), requestsPerSecond: samples.length / seconds };
}

function parseOptions(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      url: { type: 'string' },
      total: { type: 'string', default: String(DEFAULT_TOTAL) },
      concurrency: { type: 'string', default: String(DEFAULT_CONCURRENCY) },
    },
  });
  if (!values.url) throw new Error('Informe a URL com --url.');

  const total = Number(values.total);
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(total) || total < 1) throw new Error('--total deve ser um inteiro de pelo menos 1.');
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('--concurrency deve ser um inteiro de pelo menos 1.');
  }
  return { url: values.url, total, concurrency };
}

// Execução direta: `npm run carga -- --url ...`.
const isEntryPoint = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isEntryPoint) {
  try {
    const options = parseOptions(process.argv.slice(2));
    const result = await runLoadTest(options);
    console.log(`Requisições: ${result.total} (erros: ${result.errors})`);
    console.log(`Latência (ms): p50 ${result.p50.toFixed(1)} · p95 ${result.p95.toFixed(1)} · p99 ${result.p99.toFixed(1)} · máx ${result.max.toFixed(1)}`);
    console.log(`Vazão: ${result.requestsPerSecond.toFixed(1)} req/s`);
    process.exitCode = result.errors > 0 ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
