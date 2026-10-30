import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DnsResolutionError,
  SsrfBlockedError,
  assertPublicHost,
  isPrivateIp,
} from '../../src/security/ssrfGuard.js';

describe('isPrivateIp: IPv4', () => {
  const privateAddresses = [
    '0.0.0.1',
    '10.0.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '100.64.0.1',
    '100.127.255.255',
    '192.0.2.10',
    '198.18.0.1',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
  ];

  for (const address of privateAddresses) {
    test(`bloqueia ${address}`, () => {
      assert.equal(isPrivateIp(address), true);
    });
  }

  const publicAddresses = ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '93.184.216.34'];

  for (const address of publicAddresses) {
    test(`permite ${address}`, () => {
      assert.equal(isPrivateIp(address), false);
    });
  }
});

describe('isPrivateIp: IPv6', () => {
  const privateAddresses = [
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
    '64:ff9b::1.2.3.4',
    '2001:db8::1',
  ];

  for (const address of privateAddresses) {
    test(`bloqueia ${address}`, () => {
      assert.equal(isPrivateIp(address), true);
    });
  }

  test('permite IPv6 público', () => {
    assert.equal(isPrivateIp('2606:4700:4700::1111'), false);
  });

  test('permite IPv4 público embutido em ::ffff:', () => {
    assert.equal(isPrivateIp('::ffff:8.8.8.8'), false);
  });

  test('trata texto que não é IP como bloqueado', () => {
    assert.equal(isPrivateIp('exemplo.com'), true);
  });
});

describe('assertPublicHost: nomes', () => {
  const blockedNames = ['localhost', 'LOCALHOST.', 'app.localhost', 'api.internal', 'internal'];

  for (const name of blockedNames) {
    test(`bloqueia ${name} sem consultar DNS`, async () => {
      const lookup = async () => {
        throw new Error('DNS não deveria ser consultado');
      };
      await assert.rejects(assertPublicHost(name, { lookup }), SsrfBlockedError);
    });
  }

  test('bloqueia IP literal interno sem consultar DNS', async () => {
    const lookup = async () => {
      throw new Error('DNS não deveria ser consultado');
    };
    await assert.rejects(assertPublicHost('127.0.0.1', { lookup }), SsrfBlockedError);
    await assert.rejects(assertPublicHost('[::1]', { lookup }), SsrfBlockedError);
  });
});

describe('assertPublicHost: resolução DNS', () => {
  test('aceita domínio que resolve só para IP público', async () => {
    const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
    await assertPublicHost('exemplo.com', { lookup });
  });

  test('bloqueia se QUALQUER IP do domínio for privado', async () => {
    const lookup = async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ];
    await assert.rejects(assertPublicHost('exemplo.com', { lookup }), SsrfBlockedError);
  });

  test('bloqueia domínio que resolve para metadados de nuvem', async () => {
    const lookup = async () => [{ address: '169.254.169.254', family: 4 }];
    await assert.rejects(assertPublicHost('exemplo.com', { lookup }), SsrfBlockedError);
  });

  test('consulta o DNS pedindo todos os endereços', async () => {
    let received;
    const lookup = async (name, options) => {
      received = { name, options };
      return [{ address: '93.184.216.34', family: 4 }];
    };
    await assertPublicHost('exemplo.com', { lookup });
    assert.deepEqual(received, { name: 'exemplo.com', options: { all: true } });
  });

  test('falha de DNS vira erro amigável', async () => {
    const lookup = async () => {
      throw new Error('ENOTFOUND exemplo.invalido');
    };
    await assert.rejects(assertPublicHost('exemplo.invalido', { lookup }), DnsResolutionError);
  });

  test('resposta vazia do DNS é tratada como falha de resolução', async () => {
    const lookup = async () => [];
    await assert.rejects(assertPublicHost('exemplo.com', { lookup }), DnsResolutionError);
  });
});
