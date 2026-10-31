import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createDispatcher, MAX_SEND_ATTEMPTS } from '../../src/services/notifier/dispatcher.js';
import { createRoundRunner } from '../../src/services/scheduler/jobs.js';
import { createTestContext } from './helpers.js';

function seedAlerts(ctx, count) {
  const monitor = ctx.repos.monitors.create({
    userId: ctx.ownerId,
    url: 'https://exemplo.com/',
    label: 'Teste',
    intervalMinutes: 60,
  });
  for (let index = 0; index < count; index += 1) {
    ctx.repos.alerts.insert({
      monitorId: monitor.id,
      kind: 'alteracao_conteudo',
      severity: 'media',
      details: { addedCount: 1, removedCount: 0, added: [`linha ${index}`], removed: [] },
    });
  }
  return monitor;
}

describe('dispatcher: envio de alertas pendentes', () => {
  test('envia pendentes e marca como enviado', async () => {
    const ctx = createTestContext();
    seedAlerts(ctx, 2);
    const sent = [];
    const dispatch = createDispatcher({
      alerts: ctx.repos.alerts,
      sendEmail: async (message) => sent.push(message.subject),
    });

    const result = await dispatch();

    assert.deepEqual(result, { sent: 2, failed: 0 });
    assert.equal(sent.length, 2);
    const statuses = ctx.db
      .prepare('SELECT send_status FROM alerts')
      .all()
      .map((row) => row.send_status);
    assert.deepEqual(statuses, ['enviado', 'enviado']);
  });

  test('falha em um item não derruba o lote', async () => {
    const ctx = createTestContext();
    seedAlerts(ctx, 3);
    let call = 0;
    const dispatch = createDispatcher({
      alerts: ctx.repos.alerts,
      sendEmail: async () => {
        call += 1;
        if (call === 2) throw new Error('Resend fora do ar');
      },
    });

    const result = await dispatch();

    assert.deepEqual(result, { sent: 2, failed: 1 });
    const statuses = ctx.db
      .prepare('SELECT send_status FROM alerts ORDER BY id')
      .all()
      .map((row) => row.send_status);
    // O item com falha volta à fila: só fica 'falhou' depois de esgotar as tentativas.
    assert.deepEqual(statuses, ['enviado', 'pendente', 'enviado']);
  });

  test('alerta com falha volta à fila e para de tentar depois do limite', async () => {
    const ctx = createTestContext();
    seedAlerts(ctx, 1);
    const dispatch = createDispatcher({
      alerts: ctx.repos.alerts,
      sendEmail: async () => {
        throw new Error('falhou');
      },
    });

    const failures = [];
    for (let round = 0; round <= MAX_SEND_ATTEMPTS; round += 1) {
      failures.push((await dispatch()).failed);
    }

    assert.deepEqual(failures, [1, 1, 1, 0]);
    const row = ctx.db.prepare('SELECT send_status, send_attempts FROM alerts').get();
    assert.equal(row.send_status, 'falhou');
    assert.equal(row.send_attempts, MAX_SEND_ATTEMPTS);
  });

  test('falha seguida de sucesso marca o alerta como enviado', async () => {
    const ctx = createTestContext();
    seedAlerts(ctx, 1);
    let call = 0;
    const dispatch = createDispatcher({
      alerts: ctx.repos.alerts,
      sendEmail: async () => {
        call += 1;
        if (call === 1) throw new Error('instável');
      },
    });

    await dispatch();
    const second = await dispatch();

    assert.deepEqual(second, { sent: 1, failed: 0 });
    assert.equal(ctx.db.prepare('SELECT send_status FROM alerts').get().send_status, 'enviado');
  });
});

describe('agendador: rodada', () => {
  test('pula a rodada se a anterior ainda está em execução', async () => {
    let release;
    const runRound = createRoundRunner({
      findDue: () => [],
      checkMonitor: async () => {},
      dispatchPending: () =>
        new Promise((resolve) => {
          release = () => resolve({ sent: 0, failed: 0 });
        }),
    });

    const first = runRound();
    const second = await runRound();
    release();
    const firstResult = await first;

    assert.deepEqual(second, { skipped: true });
    assert.equal(firstResult.skipped, false);
  });

  test('erro em um monitor não impede os outros', async () => {
    const checked = [];
    const runRound = createRoundRunner({
      findDue: () => [{ id: 1 }, { id: 2 }, { id: 3 }],
      checkMonitor: async (monitor) => {
        if (monitor.id === 2) throw new Error('boom');
        checked.push(monitor.id);
      },
      dispatchPending: async () => ({ sent: 0, failed: 0 }),
    });

    const result = await runRound();

    assert.deepEqual(checked, [1, 3]);
    assert.equal(result.checked, 2);
  });

  test('exceção na rodada não escapa do agendador', async () => {
    const runRound = createRoundRunner({
      findDue: () => {
        throw new Error('banco indisponível');
      },
      checkMonitor: async () => {},
      dispatchPending: async () => ({ sent: 0, failed: 0 }),
    });

    const result = await runRound();

    assert.equal(result.error, 'Error');
  });
});
