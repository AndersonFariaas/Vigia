// Sufixos de segundo nível comuns (ex.: "com.br"). Sem a Public Suffix List completa:
// cobre os casos que importam para comparar nomes de marcas no Brasil e no exterior.
const SECOND_LEVEL_LABELS = new Set(['com', 'gov', 'net', 'org', 'edu', 'co', 'ac', 'adv']);

/** Nome da marca dentro do domínio: "caixa" em "internet.caixa.gov.br". */
export function registrableName(hostname) {
  const labels = hostname.toLowerCase().split('.');
  const [tld, secondLevel] = labels.slice(-2).reverse();
  const hasCountrySuffix = labels.length >= 3 && tld.length === 2 && SECOND_LEVEL_LABELS.has(secondLevel);
  return hasCountrySuffix ? labels.at(-3) : (secondLevel ?? labels[0]);
}

/** true para "bradesco.com.br" e "app.bradesco.com.br", false para "bradesco.com.br.evil.net". */
export function isSameOrSubdomain(hostname, domain) {
  const host = hostname.toLowerCase();
  const base = domain.toLowerCase();
  return host === base || host.endsWith(`.${base}`);
}
