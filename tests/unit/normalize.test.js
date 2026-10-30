import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText } from '../../src/services/scraper/normalize.js';

describe('normalizeText: ruído que não deve gerar alerta', () => {
  test('horário que muda não gera diferença', () => {
    const before = normalizeText('Atualizado às 14:32:10\nPreço: R$ 49,90');
    const after = normalizeText('Atualizado às 15:01:44\nPreço: R$ 49,90');
    assert.equal(before, after);
  });

  test('horário em formato am/pm e 14h32 também é ignorado', () => {
    assert.equal(normalizeText('Aberto às 9:05 am'), normalizeText('Aberto às 10:40 pm'));
    assert.equal(normalizeText('Fecha às 14h32'), normalizeText('Fecha às 18h05'));
  });

  test('data dd/mm/aaaa não gera diferença', () => {
    const before = normalizeText('Publicado em 12/03/2026\nTexto');
    const after = normalizeText('Publicado em 13/03/2026\nTexto');
    assert.equal(before, after);
  });

  test('data ISO e timestamp não geram diferença', () => {
    const before = normalizeText('Gerado em 2026-03-12T10:00:00.123Z');
    const after = normalizeText('Gerado em 2026-04-01T23:59:59+03:00');
    assert.equal(before, after);
  });

  test('token hexadecimal não gera diferença', () => {
    const before = normalizeText('Sessão 9f8e7d6c5b4a3920abcdef');
    const after = normalizeText('Sessão 0123456789abcdef0123');
    assert.equal(before, after);
  });

  test('hash hexadecimal em nome de arquivo não gera diferença', () => {
    const before = normalizeText('![logo](/img/logo-3f2a9c8b7d6e5f4a.png)');
    const after = normalizeText('![logo](/img/logo-aa11bb22cc33dd44.png)');
    assert.equal(before, after);
  });

  test('parâmetros de cache na URL são removidos', () => {
    const before = normalizeText('https://cdn.exemplo.com/app.js?v=123&id=5');
    const after = normalizeText('https://cdn.exemplo.com/app.js?v=999&id=5');
    assert.equal(before, after);
    assert.equal(normalizeText('https://x.com/a.css?_=1700000000'), 'https://x.com/a.css');
  });

  test('parâmetro útil na URL continua no texto', () => {
    assert.equal(
      normalizeText('https://loja.com/p?id=42&_=99'),
      normalizeText('https://loja.com/p?id=42'),
    );
    assert.notEqual(
      normalizeText('https://loja.com/p?id=42'),
      normalizeText('https://loja.com/p?id=43'),
    );
  });
});

describe('normalizeText: mudanças reais continuam visíveis', () => {
  test('mudança de preço gera texto diferente', () => {
    const before = normalizeText('Preço: R$ 49,90');
    const after = normalizeText('Preço: R$ 39,90');
    assert.notEqual(before, after);
  });

  test('mudança de palavra gera texto diferente', () => {
    assert.notEqual(normalizeText('Status: disponível'), normalizeText('Status: esgotado'));
  });
});

describe('normalizeText: espaços e linhas', () => {
  test('colapsa espaços e remove linhas vazias', () => {
    assert.equal(normalizeText('Olá   mundo\n\n\n  Fim  '), 'Olá mundo\nFim');
  });

  test('aceita CRLF', () => {
    assert.equal(normalizeText('a\r\nb'), 'a\nb');
  });

  test('entrada que não é texto vira string vazia', () => {
    assert.equal(normalizeText(null), '');
    assert.equal(normalizeText(undefined), '');
  });
});
