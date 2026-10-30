import dns from 'node:dns/promises';
import net from 'node:net';

// Bloquear em dúvida: uma lista de faixas a menos é um risco; uma a mais é só um falso positivo.

export class SsrfBlockedError extends Error {
  constructor() {
    super('Endereço não permitido: o domínio aponta para uma rede privada ou interna.');
    this.name = 'SsrfBlockedError';
    this.code = 'SSRF_BLOCKED';
    this.status = 400;
    this.expose = true;
  }
}

export class DnsResolutionError extends Error {
  constructor() {
    super('Não foi possível resolver o domínio.');
    this.name = 'DnsResolutionError';
    this.code = 'DNS_FALHOU';
    this.status = 400;
    this.expose = true;
  }
}

const BLOCKED_HOSTNAMES = ['localhost', 'internal'];

// [base, prefixo em bits]
const IPV4_BLOCKED_RANGES = [
  ['0.0.0.0', 8], // "esta rede"
  ['10.0.0.0', 8], // privada
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, inclui metadados de nuvem (169.254.169.254)
  ['172.16.0.0', 12], // privada
  ['192.0.0.0', 24], // reservada para protocolos IETF
  ['192.0.2.0', 24], // documentação (TEST-NET-1)
  ['192.168.0.0', 16], // privada
  ['198.18.0.0', 15], // benchmark
  ['198.51.100.0', 24], // documentação (TEST-NET-2)
  ['203.0.113.0', 24], // documentação (TEST-NET-3)
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reservada, inclui broadcast
];

const IPV6_BLOCKED_RANGES = [
  '::/128', // não especificado
  '::1/128', // loopback
  '::/96', // IPv4 compatível (obsoleto), inclui ::1 e ::
  '64:ff9b::/96', // NAT64: pode levar a qualquer IPv4 interno
  '100::/64', // descarte
  '2001::/32', // Teredo
  '2001:db8::/32', // documentação
  '2002::/16', // 6to4
  'fc00::/7', // ULA (privado)
  'fe80::/10', // link-local
  'fec0::/10', // site-local (obsoleto)
  'ff00::/8', // multicast
];

const IPV4_MAPPED_PREFIX_GROUPS = 5;
const IPV4_MAPPED_MARKER = 0xffff;
const HEX_RADIX = 16;
const BITS_PER_HEXTET = 16;
const IPV6_HEXTETS = 8;
const IPV6_BITS = 128;

function ipv4ToInt(address) {
  return address.split('.').reduce((acc, octet) => acc * 256 + Number(octet), 0);
}

function ipv4InRange(address, base, prefixBits) {
  const size = 2 ** (32 - prefixBits);
  const start = ipv4ToInt(base);
  const value = ipv4ToInt(address);
  return value >= start && value < start + size;
}

function isPrivateIPv4(address) {
  return IPV4_BLOCKED_RANGES.some(([base, bits]) => ipv4InRange(address, base, bits));
}

/**
 * Converte IPv6 em 8 grupos numéricos, expandindo "::" e o formato
 * com IPv4 embutido (ex.: ::ffff:127.0.0.1). Retorna null se não entender.
 */
function expandIPv6(address) {
  let text = address.split('%')[0].toLowerCase();

  if (text.includes('.')) {
    const cut = text.lastIndexOf(':');
    const [a, b, c, d] = text.slice(cut + 1).split('.').map(Number);
    const high = ((a << 8) | b).toString(HEX_RADIX);
    const low = ((c << 8) | d).toString(HEX_RADIX);
    text = `${text.slice(0, cut + 1)}${high}:${low}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const gap = halves.length === 2 ? IPV6_HEXTETS - head.length - tail.length : 0;
  const groups = [...head, ...Array(gap).fill('0'), ...tail];

  if (groups.length !== IPV6_HEXTETS) return null;

  const values = groups.map((group) => parseInt(group, HEX_RADIX));
  return values.some((value) => Number.isNaN(value) || value > 0xffff) ? null : values;
}

function toBigInt(groups) {
  return groups.reduce((acc, group) => (acc << BigInt(BITS_PER_HEXTET)) | BigInt(group), 0n);
}

function ipv6InRange(value, cidr) {
  const [base, bits] = cidr.split('/');
  const shift = BigInt(IPV6_BITS - Number(bits));
  return value >> shift === toBigInt(expandIPv6(base)) >> shift;
}

function isPrivateIPv6(address) {
  const groups = expandIPv6(address);
  if (!groups) return true;

  const isIPv4Mapped =
    groups.slice(0, IPV4_MAPPED_PREFIX_GROUPS).every((group) => group === 0) &&
    groups[IPV4_MAPPED_PREFIX_GROUPS] === IPV4_MAPPED_MARKER;

  if (isIPv4Mapped) {
    const [high, low] = groups.slice(6);
    const embedded = [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
    return isPrivateIPv4(embedded);
  }

  const value = toBigInt(groups);
  return IPV6_BLOCKED_RANGES.some((cidr) => ipv6InRange(value, cidr));
}

/**
 * Diz se um endereço IP é interno ou reservado. Texto que não é IP é tratado
 * como bloqueado, porque a função não deve ser usada para decidir sobre domínios.
 */
export function isPrivateIp(address) {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) return isPrivateIPv6(address);
  return true;
}

function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

export function isBlockedHostname(hostname) {
  const name = normalizeHostname(hostname);
  return BLOCKED_HOSTNAMES.some((blocked) => name === blocked || name.endsWith(`.${blocked}`));
}

const defaultLookup = (hostname) => dns.lookup(hostname, { all: true });

/**
 * Garante que o domínio resolve só para IPs públicos.
 * Checa TODOS os IPs retornados: basta um interno para bloquear, porque
 * o cliente HTTP pode acabar usando qualquer um deles.
 */
export async function assertPublicHost(hostname, { lookup = defaultLookup } = {}) {
  const name = normalizeHostname(hostname);

  if (net.isIP(name)) {
    if (isPrivateIp(name)) throw new SsrfBlockedError();
    return;
  }

  if (isBlockedHostname(name)) throw new SsrfBlockedError();

  let addresses;
  try {
    addresses = await lookup(name, { all: true });
  } catch {
    throw new DnsResolutionError();
  }

  if (!addresses?.length) throw new DnsResolutionError();
  if (addresses.some(({ address }) => isPrivateIp(address))) throw new SsrfBlockedError();
}
