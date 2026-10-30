import { REFERENCE_DOMAINS } from './referenceDomains.js';
import { levenshtein } from './levenshtein.js';
import { isSameOrSubdomain, registrableName } from './hostnames.js';

// Nomes curtos têm muitos vizinhos legítimos ("bb", "bbb"), então não são comparados.
const MIN_NAME_LENGTH = 5;
const MAX_DISTANCE = 2;

/**
 * Devolve o domínio oficial que o host imita, ou null.
 * Domínio oficial (ou subdomínio dele) nunca é considerado imitação.
 */
export function findLookalike(hostname) {
  const isOfficial = REFERENCE_DOMAINS.some((domain) => isSameOrSubdomain(hostname, domain));
  if (isOfficial) return null;

  const name = registrableName(hostname);
  if (name.length < MIN_NAME_LENGTH) return null;

  return (
    REFERENCE_DOMAINS.find((domain) => {
      const brand = registrableName(domain);
      return name !== brand && levenshtein(name, brand) <= MAX_DISTANCE;
    }) ?? null
  );
}
