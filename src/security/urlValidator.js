export class UrlValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UrlValidationError';
    this.code = 'URL_INVALIDA';
    this.status = 400;
    this.expose = true;
  }
}

const MAX_URL_LENGTH = 2048;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
// Porta vazia = padrão do protocolo (80 para http, 443 para https).
const ALLOWED_PORTS = new Set(['', '80', '443']);

/**
 * Valida a URL que o usuário quer monitorar e devolve a forma normalizada.
 * Essa checagem não toca na rede: a proteção contra IPs internos fica no ssrfGuard.
 */
export function validateMonitorUrl(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new UrlValidationError('Informe a URL da página.');
  }

  const raw = input.trim();
  if (raw.length > MAX_URL_LENGTH) {
    throw new UrlValidationError(`A URL deve ter no máximo ${MAX_URL_LENGTH} caracteres.`);
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlValidationError('A URL é inválida.');
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new UrlValidationError('Somente endereços http:// e https:// são aceitos.');
  }

  if (url.username || url.password) {
    throw new UrlValidationError('A URL não pode conter usuário ou senha.');
  }

  if (!ALLOWED_PORTS.has(url.port)) {
    throw new UrlValidationError('Somente as portas 80 e 443 são aceitas.');
  }

  // Sem ponto, o nome costuma ser interno (ex.: "intranet"). Também barra [::1].
  if (!url.hostname.includes('.')) {
    throw new UrlValidationError('O domínio precisa ter ponto (ex.: exemplo.com).');
  }

  // O fragmento (#secao) não é enviado ao servidor; manter a URL sem ele evita duplicatas.
  url.hash = '';
  return url.href;
}
