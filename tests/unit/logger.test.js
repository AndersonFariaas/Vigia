import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../src/logger.js';

function captureStreams() {
  const out = [];
  const err = [];
  return {
    out,
    err,
    streams: {
      out: { write: (line) => out.push(line) },
      err: { write: (line) => err.push(line) },
      now: () => new Date('2026-10-31T12:00:00.000Z'),
    },
  };
}

describe('logger estruturado', () => {
  test('cada evento vira uma linha JSON com horário, nível e mensagem', () => {
    const capture = captureStreams();
    const log = createLogger(capture.streams);

    log('info', 'Servidor iniciado');

    assert.equal(capture.out.length, 1);
    assert.ok(capture.out[0].endsWith('\n'));
    assert.deepEqual(JSON.parse(capture.out[0]), {
      time: '2026-10-31T12:00:00.000Z',
      level: 'info',
      msg: 'Servidor iniciado',
    });
  });

  test('campos extras entram no JSON', () => {
    const capture = captureStreams();
    const log = createLogger(capture.streams);

    log('info', 'requisicao', { method: 'GET', status: 200 });

    const entry = JSON.parse(capture.out[0]);
    assert.equal(entry.method, 'GET');
    assert.equal(entry.status, 200);
  });

  test('erros vão para o canal de erro; o resto vai para a saída normal', () => {
    const capture = captureStreams();
    const log = createLogger(capture.streams);

    log('warn', 'atenção');
    log('error', 'falhou');

    assert.equal(capture.out.length, 1);
    assert.equal(capture.err.length, 1);
    assert.equal(JSON.parse(capture.err[0]).level, 'error');
  });
});
