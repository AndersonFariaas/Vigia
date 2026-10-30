// Ruído que muda sem a página ter mudado de verdade: gera alerta falso se não for removido.

// Parâmetros de cache e de sessão nas URLs. O regex também consome o "&" seguinte
// para que a URL continue válida depois da remoção.
const CACHE_PARAM_PATTERN =
  /([?&])(?:_|v|t|ts|cb|nonce|rnd|timestamp|cache|cachebuster|sid|sessionid|token)=[^&\s)"'<>]*(&?)/gi;

const NOISE_PATTERNS = [
  /\b\d{2}\/\d{2}\/\d{4}\b/g, // dd/mm/aaaa
  /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/g, // ISO 8601
  /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?m\.?)?\b/gi, // 14:32, 14:32:10, 2:05 pm
  /\b\d{1,2}h\d{2}\b/gi, // 14h32
  /\b[a-f0-9]{16,}\b/gi, // tokens e hashes hexadecimais
];

/**
 * Remove o ruído e deixa só o texto que o usuário vê.
 * Linhas vazias saem junto: não carregam informação e atrapalhariam o diff.
 */
export function normalizeText(markdown) {
  if (typeof markdown !== 'string') return '';

  const withoutCacheParams = markdown.replace(
    CACHE_PARAM_PATTERN,
    (_match, separator, continuation) => (continuation ? separator : ''),
  );

  const withoutNoise = NOISE_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, ''),
    withoutCacheParams,
  );

  return withoutNoise
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}
