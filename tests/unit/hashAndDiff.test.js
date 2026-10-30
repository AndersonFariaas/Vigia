import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../../src/services/diff/hash.js';
import { diffLines } from '../../src/services/diff/textDiff.js';

describe('sha256', () => {
  test('gera hash de 64 caracteres hexadecimais', () => {
    assert.match(sha256('qualquer texto'), /^[0-9a-f]{64}$/);
  });

  test('é determinístico', () => {
    assert.equal(sha256('vigia'), sha256('vigia'));
  });

  test('bate com o vetor de teste conhecido do SHA-256 ("abc")', () => {
    assert.equal(
      sha256('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('textos diferentes geram hashes diferentes', () => {
    assert.notEqual(sha256('a'), sha256('b'));
  });
});

describe('diffLines', () => {
  test('lista linhas adicionadas e removidas', () => {
    const diff = diffLines('a\nb\nc', 'a\nc\nd');
    assert.deepEqual(diff.added, ['d']);
    assert.deepEqual(diff.removed, ['b']);
    assert.equal(diff.addedCount, 1);
    assert.equal(diff.removedCount, 1);
  });

  test('texto idêntico não tem diferenças', () => {
    const diff = diffLines('a\nb', 'a\nb');
    assert.equal(diff.addedCount, 0);
    assert.equal(diff.removedCount, 0);
  });

  test('amostra tem no máximo 5 linhas, mas a contagem é total', () => {
    const added = Array.from({ length: 8 }, (_, index) => `nova ${index}`).join('\n');
    const diff = diffLines('', added);
    assert.equal(diff.addedCount, 8);
    assert.equal(diff.added.length, 5);
  });

  test('amostra de removidas também limita a 5', () => {
    const removed = Array.from({ length: 7 }, (_, index) => `velha ${index}`).join('\n');
    const diff = diffLines(removed, '');
    assert.equal(diff.removed.length, 5);
    assert.equal(diff.removedCount, 7);
  });

  test('linha muito longa é cortada na amostra', () => {
    const diff = diffLines('', 'x'.repeat(1000));
    assert.ok(diff.added[0].length <= 301);
  });

  test('texto anterior vazio conta tudo como adicionado', () => {
    const diff = diffLines(undefined, 'a\nb');
    assert.equal(diff.addedCount, 2);
  });
});
