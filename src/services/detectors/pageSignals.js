import { parse } from 'parse5';

/** Percorre todos os elementos da árvore, inclusive o conteúdo de <template>. */
function* elementsIn(node) {
  if (node.attrs) yield node;
  for (const child of node.childNodes ?? []) yield* elementsIn(child);
  if (node.content) yield* elementsIn(node.content);
}

function attribute(element, name) {
  return element.attrs.find((attr) => attr.name === name)?.value ?? null;
}

/** Só http e https. `javascript:`, `mailto:` e URLs inválidas viram null. */
function resolveHttpUrl(value, base) {
  try {
    const url = new URL(value, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function isPasswordInput(element) {
  return element.nodeName === 'input' && attribute(element, 'type')?.toLowerCase() === 'password';
}

/**
 * Extrai do HTML o que importa para segurança: para onde cada formulário envia os dados,
 * se ele pede senha, e de quais outros domínios a página carrega scripts.
 * A query string da ação é descartada: pode conter tokens.
 */
export function readPageSignals({ html = '', pageUrl }) {
  if (!html) return { forms: [], externalScripts: [] };

  const pageHost = new URL(pageUrl).hostname.toLowerCase();
  const elements = [...elementsIn(parse(html))];

  const forms = elements
    .filter((element) => element.nodeName === 'form')
    .map((form) => {
      // Formulário sem action envia para a própria página.
      const action = resolveHttpUrl(attribute(form, 'action') ?? '', pageUrl);
      return {
        action: action ? `${action.origin}${action.pathname}` : null,
        actionHost: action?.hostname.toLowerCase() ?? null,
        hasPassword: [...elementsIn(form)].some(isPasswordInput),
      };
    });

  const externalScripts = elements
    .filter((element) => element.nodeName === 'script' && attribute(element, 'src') !== null)
    .map((script) => resolveHttpUrl(attribute(script, 'src'), pageUrl))
    .filter((url) => url && url.hostname.toLowerCase() !== pageHost)
    .map((url) => url.hostname.toLowerCase());

  return { forms, externalScripts: [...new Set(externalScripts)].sort() };
}
