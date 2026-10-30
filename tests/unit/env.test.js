import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, loadConfig } from '../../src/config/env.js';

const validEnv = {
  FIRECRAWL_API_KEY: 'fc-teste',
  RESEND_API_KEY: 're_teste',
  ALERT_EMAIL_FROM: 'Vigia <alertas@exemplo.com>',
  DEVIN_API_KEY: 'cog_teste',
  DEVIN_ORG_ID: 'org-abc123',
};

describe('loadConfig', () => {
  test('aplica os valores padrão quando só os obrigatórios existem', () => {
    const config = loadConfig(validEnv);
    assert.equal(config.FIRECRAWL_BASE_URL, 'https://api.firecrawl.dev');
    assert.equal(config.CHECK_CRON, '*/15 * * * *');
    assert.equal(config.HOST, '127.0.0.1');
    assert.equal(config.PORT, 3000);
    assert.equal(config.DATABASE_PATH, './data/vigia.db');
    assert.equal(config.DEVIN_MAX_ACU_LIMIT, 2);
  });

  test('lista todas as variáveis faltantes de uma vez', () => {
    assert.throws(
      () => loadConfig({}),
      (error) => {
        assert.ok(error instanceof ConfigError);
        for (const name of [
          'FIRECRAWL_API_KEY',
          'RESEND_API_KEY',
          'ALERT_EMAIL_FROM',
          'DEVIN_API_KEY',
          'DEVIN_ORG_ID',
        ]) {
          assert.ok(error.message.includes(name), `faltou ${name} na mensagem`);
        }
        assert.ok(error.message.includes('variável ausente'));
        return true;
      },
    );
  });

  test('rejeita expressão cron inválida', () => {
    assert.throws(() => loadConfig({ ...validEnv, CHECK_CRON: 'não é cron' }), /CHECK_CRON/);
  });

  test('rejeita base da Firecrawl que não é http(s)', () => {
    assert.throws(
      () => loadConfig({ ...validEnv, FIRECRAWL_BASE_URL: 'ftp://x.com' }),
      /FIRECRAWL_BASE_URL/,
    );
  });

  test('rejeita ID de organização da Devin sem o prefixo org-', () => {
    assert.throws(() => loadConfig({ ...validEnv, DEVIN_ORG_ID: 'abc123' }), /DEVIN_ORG_ID/);
  });

  test('limita o teto de ACUs entre 1 e 10', () => {
    assert.throws(() => loadConfig({ ...validEnv, DEVIN_MAX_ACU_LIMIT: 0 }), /DEVIN_MAX_ACU_LIMIT/);
    assert.throws(() => loadConfig({ ...validEnv, DEVIN_MAX_ACU_LIMIT: 50 }), /DEVIN_MAX_ACU_LIMIT/);
    assert.equal(loadConfig({ ...validEnv, DEVIN_MAX_ACU_LIMIT: '5' }).DEVIN_MAX_ACU_LIMIT, 5);
  });

  test('cadastro aberto vem ligado e aceita só true ou false', () => {
    assert.equal(loadConfig(validEnv).CADASTRO_ABERTO, true);
    assert.equal(loadConfig({ ...validEnv, CADASTRO_ABERTO: 'false' }).CADASTRO_ABERTO, false);
    assert.throws(() => loadConfig({ ...validEnv, CADASTRO_ABERTO: 'talvez' }), /CADASTRO_ABERTO/);
  });

  test('erro de configuração não expõe os valores dos segredos', () => {
    try {
      loadConfig({ ...validEnv, DEVIN_MAX_ACU_LIMIT: 'abc', PORT: 'abc' });
      assert.fail('deveria ter lançado');
    } catch (error) {
      assert.equal(error.message.includes('fc-teste'), false);
      assert.equal(error.message.includes('re_teste'), false);
    }
  });
});
