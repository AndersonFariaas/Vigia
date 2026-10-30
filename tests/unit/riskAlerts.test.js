import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderAlertEmail } from '../../src/services/notifier/dispatcher.js';
import { buildAnalysisPrompt } from '../../src/services/analyst/analysisPrompt.js';

const riskAlert = {
  kind: 'risco',
  severity: 'alta',
  monitor_url: 'https://bradesc0.com.br/login',
  monitor_label: 'Bradesco falso',
  details: {
    chave: 'senha-externa:coletor.example.net',
    titulo: '<img src=x onerror=alert(1)> envia dados',
    descricao: 'Campo de senha envia para <script>coletor.example.net</script>.',
  },
};

describe('e-mail de alerta de risco', () => {
  test('assunto traz a gravidade e o nome do monitor', () => {
    const { subject } = renderAlertEmail(riskAlert);
    assert.equal(subject, 'Vigia: risco alto em Bradesco falso');
  });

  test('título e descrição vindos da página são escapados no HTML', () => {
    const { html } = renderAlertEmail(riskAlert);
    assert.equal(html.includes('<img src=x'), false);
    assert.equal(html.includes('<script>coletor'), false);
    assert.ok(html.includes('&lt;script&gt;coletor.example.net&lt;/script&gt;'));
  });

  test('o texto puro traz o aviso para verificar o site antes de digitar senhas', () => {
    const { text } = renderAlertEmail(riskAlert);
    assert.ok(text.includes('Verifique o site diretamente'));
  });

  test('alerta de conteúdo continua com o assunto antigo', () => {
    const { subject } = renderAlertEmail({
      kind: 'alteracao_conteudo',
      severity: 'media',
      monitor_url: 'https://exemplo.com/',
      monitor_label: 'Preços',
      details: { addedCount: 0, removedCount: 0, added: [], removed: [] },
    });
    assert.equal(subject, 'Vigia: alteração em Preços');
  });
});

describe('prompt da análise para alertas de risco', () => {
  test('usa o título e a descrição do risco, dentro do bloco de dados', () => {
    const prompt = buildAnalysisPrompt({
      monitor: { url: 'https://bradesc0.com.br/login', label: 'Bradesco falso' },
      details: riskAlert.details,
    });

    assert.ok(prompt.includes('Sinal de risco: '));
    assert.ok(prompt.includes('Campo de senha envia para'));
    assert.equal(prompt.includes('Linhas adicionadas'), false);
  });
});
