import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { levenshtein } from '../../src/services/detectors/levenshtein.js';
import { registrableName } from '../../src/services/detectors/hostnames.js';
import { findLookalike } from '../../src/services/detectors/lookalike.js';
import { readPageSignals } from '../../src/services/detectors/pageSignals.js';
import { buildRisks } from '../../src/services/detectors/risks.js';
import { readCertificateExpiry } from '../../src/services/detectors/certificate.js';

const fixture = (path) => readFileSync(new URL(`../fixtures/${path}`, import.meta.url), 'utf8');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('levenshtein', () => {
  test('conta inserções, remoções e trocas', () => {
    assert.equal(levenshtein('caixa', 'caixa'), 0);
    assert.equal(levenshtein('bradesco', 'bradesc0'), 1);
    assert.equal(levenshtein('abc', ''), 3);
  });
});

describe('registrableName', () => {
  test('pega o nome da marca, ignorando subdomínio e sufixo .com.br / .gov.br', () => {
    assert.equal(registrableName('bradesc0.com.br'), 'bradesc0');
    assert.equal(registrableName('internet.caixa.gov.br'), 'caixa');
    assert.equal(registrableName('paypa1.com'), 'paypa1');
    assert.equal(registrableName('localhost'), 'localhost');
  });
});

describe('findLookalike', () => {
  test('encontra domínios que imitam marcas conhecidas', () => {
    assert.equal(findLookalike('bradesc0.com.br'), 'bradesco.com.br');
    assert.equal(findLookalike('paypa1.com'), 'paypal.com');
    assert.equal(findLookalike('nubanc.com.br'), 'nubank.com.br');
  });

  test('domínio oficial e subdomínios dele nunca são imitação', () => {
    assert.equal(findLookalike('www.nubank.com.br'), null);
    assert.equal(findLookalike('internet.caixa.gov.br'), null);
  });

  test('nomes curtos não são comparados, porque têm muitos vizinhos legítimos', () => {
    assert.equal(findLookalike('bbb.com'), null);
  });

  test('um domínio que só começa com a marca não é imitação', () => {
    assert.equal(findLookalike('bradesco.com.br.evil.net'), null);
  });

  test('site sem relação com as marcas da lista passa limpo', () => {
    assert.equal(findLookalike('noticias-exemplo.org'), null);
  });
});

describe('readPageSignals', () => {
  test('lê o destino do formulário de senha e os domínios de script', () => {
    const signals = readPageSignals({
      html: fixture('phishing/nubanc-login-rastreado.html'),
      pageUrl: 'https://nubanc.com.br/entrar',
    });

    assert.deepEqual(signals.externalScripts, ['cdn.rastreio-exemplo.net']);
    assert.deepEqual(signals.forms, [
      { action: 'https://painel-exemplo.net/entrar', actionHost: 'painel-exemplo.net', hasPassword: true },
    ]);
  });

  test('formulário sem action envia para a própria página e scripts do mesmo host não contam', () => {
    const signals = readPageSignals({
      html: fixture('normais/caixa-login-oficial.html'),
      pageUrl: 'https://internet.caixa.gov.br/login',
    });

    assert.equal(signals.forms[0].actionHost, 'internet.caixa.gov.br');
    assert.deepEqual(signals.externalScripts, ['www.googletagmanager.com']);
  });

  test('javascript: não vira destino, mas o campo de senha continua contando', () => {
    const signals = readPageSignals({
      html: '<form action="javascript:void(0)"><input type="password"></form>',
      pageUrl: 'https://exemplo.com/',
    });

    assert.deepEqual(signals.forms, [{ action: null, actionHost: null, hasPassword: true }]);
  });

  test('a query string da ação é descartada, porque pode levar tokens', () => {
    const signals = readPageSignals({
      html: '<form action="https://destino.com/a?token=segredo"><input type="password"></form>',
      pageUrl: 'https://exemplo.com/',
    });

    assert.equal(signals.forms[0].action, 'https://destino.com/a');
  });

  test('sem HTML, não há sinais', () => {
    assert.deepEqual(readPageSignals({ html: '', pageUrl: 'https://exemplo.com/' }), {
      forms: [],
      externalScripts: [],
    });
  });
});

describe('buildRisks', () => {
  test('formulário de senha enviando para outro site é alta e vale na primeira leitura', () => {
    const risks = buildRisks({
      signals: readPageSignals({ html: fixture('phishing/bradesco-falso.html'), pageUrl: 'https://bradesc0.com.br/login' }),
      pageUrl: 'https://bradesc0.com.br/login',
    });

    const external = risks.find((risk) => risk.key === 'senha-externa:coletor-dados.example.net');
    assert.equal(external.severity, 'alta');
    assert.equal(external.baseline, true);
    assert.ok(risks.some((risk) => risk.key === 'dominio-parecido:bradesc0.com.br' && risk.severity === 'alta'));
  });

  test('script novo é baixa e só alerta quando aparece depois (baseline falso)', () => {
    const risks = buildRisks({
      signals: readPageSignals({ html: fixture('phishing/nubanc-login-rastreado.html'), pageUrl: 'https://nubanc.com.br/entrar' }),
      pageUrl: 'https://nubanc.com.br/entrar',
    });

    const script = risks.find((risk) => risk.key === 'script:cdn.rastreio-exemplo.net');
    assert.equal(script.severity, 'baixa');
    assert.equal(script.baseline, false);
  });

  test('página oficial não gera nenhum risco que alerte na primeira leitura', () => {
    const risks = buildRisks({
      signals: readPageSignals({ html: fixture('normais/nubank-login-oficial.html'), pageUrl: 'https://www.nubank.com.br/entrar' }),
      pageUrl: 'https://www.nubank.com.br/entrar',
    });

    assert.deepEqual(risks.filter((risk) => risk.baseline), []);
  });

  test('certificado perto do vencimento é média; vencido é alta', () => {
    const now = new Date('2026-10-30T12:00:00Z');
    const signals = { forms: [], externalScripts: [] };
    const soon = new Date(now.getTime() + 5 * DAY_MS).toISOString();
    const expired = new Date(now.getTime() - DAY_MS).toISOString();
    const distant = new Date(now.getTime() + 60 * DAY_MS).toISOString();

    const pageUrl = 'https://exemplo.com/';
    assert.equal(buildRisks({ signals, pageUrl, certificateValidTo: soon, now })[0].key, 'certificado-expirando');
    assert.equal(buildRisks({ signals, pageUrl, certificateValidTo: soon, now })[0].severity, 'media');
    assert.equal(buildRisks({ signals, pageUrl, certificateValidTo: expired, now })[0].severity, 'alta');
    assert.deepEqual(buildRisks({ signals, pageUrl, certificateValidTo: distant, now }), []);
    assert.deepEqual(buildRisks({ signals, pageUrl, certificateValidTo: null, now }), []);
  });
});

describe('readCertificateExpiry', () => {
  // Conexão falsa: emite um evento logo depois de criada, como o tls.connect real.
  const fakeConnect = ({ event = 'secureConnect', validTo } = {}) => {
    return () => {
      const socket = new EventEmitter();
      socket.getPeerCertificate = () => ({ valid_to: validTo });
      socket.destroy = () => {};
      socket.end = () => {};
      setImmediate(() => socket.emit(event, new Error('evento de teste')));
      return socket;
    };
  };

  test('devolve a validade do certificado em ISO', async () => {
    const validTo = await readCertificateExpiry('exemplo.com', {
      connect: fakeConnect({ validTo: 'Jun 26 12:00:00 2027 GMT' }),
    });
    assert.equal(validTo, '2027-06-26T12:00:00.000Z');
  });

  test('data que não dá para ler vira null, sem derrubar a checagem', async () => {
    const validTo = await readCertificateExpiry('exemplo.com', {
      connect: fakeConnect({ validTo: 'nao é data' }),
    });
    assert.equal(validTo, null);
  });

  test('erro de conexão e timeout viram null', async () => {
    assert.equal(await readCertificateExpiry('exemplo.com', { connect: fakeConnect({ event: 'error' }) }), null);
    assert.equal(await readCertificateExpiry('exemplo.com', { connect: fakeConnect({ event: 'timeout' }) }), null);
  });
});
