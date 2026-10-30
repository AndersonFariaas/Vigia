import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { UrlValidationError, validateMonitorUrl } from '../../src/security/urlValidator.js';

describe('validateMonitorUrl: aceita', () => {
  test('https simples', () => {
    assert.equal(validateMonitorUrl('https://exemplo.com/precos'), 'https://exemplo.com/precos');
  });

  test('remove o fragmento (#secao)', () => {
    assert.equal(validateMonitorUrl('https://exemplo.com/a#topo'), 'https://exemplo.com/a');
  });

  test('porta 80 em http é o padrão e é aceita', () => {
    assert.equal(validateMonitorUrl('http://exemplo.com:80/'), 'http://exemplo.com/');
  });

  test('remove espaços nas pontas', () => {
    assert.equal(validateMonitorUrl('  https://exemplo.com  '), 'https://exemplo.com/');
  });
});

describe('validateMonitorUrl: rejeita', () => {
  const cases = [
    ['file://', 'file:///etc/passwd', 'Somente endereços http'],
    ['ftp://', 'ftp://exemplo.com/arquivo', 'Somente endereços http'],
    ['credenciais', 'https://usuario:senha@exemplo.com/', 'usuário ou senha'],
    ['porta fora do padrão', 'https://exemplo.com:8080/', 'portas 80 e 443'],
    ['hostname sem ponto', 'https://intranet/', 'precisa ter ponto'],
    ['IPv6 literal sem ponto', 'https://[::1]/', 'precisa ter ponto'],
    ['texto que não é URL', 'não é uma url', 'inválida'],
    ['vazio', '   ', 'Informe a URL'],
    ['não é texto', 42, 'Informe a URL'],
  ];

  for (const [name, input, expected] of cases) {
    test(`${name}`, () => {
      assert.throws(
        () => validateMonitorUrl(input),
        (error) => error instanceof UrlValidationError && error.message.includes(expected),
      );
    });
  }

  test('URL com mais de 2048 caracteres', () => {
    const longUrl = `https://exemplo.com/${'a'.repeat(2048)}`;
    assert.throws(() => validateMonitorUrl(longUrl), /2048 caracteres/);
  });

  test('erros de validação têm status 400 e podem ser exibidos', () => {
    try {
      validateMonitorUrl('file:///x');
      assert.fail('deveria ter lançado');
    } catch (error) {
      assert.equal(error.status, 400);
      assert.equal(error.expose, true);
    }
  });
});
