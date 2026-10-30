import { setTimeout as sleep } from 'node:timers/promises';

const SCRAPE_PATH = '/v1/scrape';
const REQUEST_TIMEOUT_MS = 30_000;
// Backoff curto: a checagem roda em lote, e esperar mais travaria a rodada inteira.
const RETRY_DELAYS_MS = [2_000, 8_000];

export class ScrapeError extends Error {
  constructor(code, message, { retryable = false, status } = {}) {
    super(message);
    this.name = 'ScrapeError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

// Mensagens que o usuário entende. A resposta crua da API nunca é repassada.
// 429 não entra aqui: é tratado como retentável em statusError.
const CLIENT_ERRORS = {
  401: ['FIRECRAWL_AUTH', 'Chave da Firecrawl inválida ou sem permissão.'],
  403: ['FIRECRAWL_AUTH', 'Chave da Firecrawl inválida ou sem permissão.'],
  402: ['FIRECRAWL_SEM_CREDITO', 'Sem créditos na Firecrawl. Verifique o plano da conta.'],
};

const DEFAULT_CLIENT_ERROR = ['FIRECRAWL_REQUISICAO', 'A Firecrawl recusou a requisição.'];

function statusError(status) {
  if (status === 429 || status >= 500) {
    return new ScrapeError(
      'FIRECRAWL_INDISPONIVEL',
      'A Firecrawl está indisponível no momento.',
      { retryable: true, status },
    );
  }
  const [code, message] = CLIENT_ERRORS[status] ?? DEFAULT_CLIENT_ERROR;
  return new ScrapeError(code, message, { status });
}

/**
 * Cliente da Firecrawl. Retenta só o que vale a pena: 429, 5xx, rede e timeout.
 * Erros 4xx (como 402, sem créditos) não mudam ao repetir, então falham de imediato.
 */
export function createFirecrawlClient({
  apiKey,
  baseUrl,
  fetchImpl = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  retryDelaysMs = RETRY_DELAYS_MS,
  wait = sleep,
}) {
  async function requestOnce(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(`${baseUrl}${SCRAPE_PATH}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, formats: ['markdown', 'html'] }),
        signal: controller.signal,
      });

      if (!response.ok) throw statusError(response.status);

      const payload = await response.json();
      if (!payload?.success) {
        throw new ScrapeError(
          'FIRECRAWL_RESPOSTA_INVALIDA',
          'A Firecrawl não conseguiu extrair a página.',
        );
      }

      return { markdown: payload.data?.markdown ?? '' };
    } catch (error) {
      if (error instanceof ScrapeError) throw error;
      if (error.name === 'AbortError') {
        throw new ScrapeError('FIRECRAWL_TIMEOUT', 'A Firecrawl demorou demais para responder.', {
          retryable: true,
        });
      }
      if (error instanceof SyntaxError) {
        throw new ScrapeError(
          'FIRECRAWL_RESPOSTA_INVALIDA',
          'A Firecrawl devolveu uma resposta inválida.',
        );
      }
      throw new ScrapeError('FIRECRAWL_REDE', 'Falha de rede ao falar com a Firecrawl.', {
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return async function scrape(url) {
    const maxAttempts = retryDelaysMs.length + 1;

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await requestOnce(url);
      } catch (error) {
        const canRetry = error.retryable && attempt < maxAttempts;
        if (!canRetry) throw error;
        await wait(retryDelaysMs[attempt - 1]);
      }
    }
  };
}
