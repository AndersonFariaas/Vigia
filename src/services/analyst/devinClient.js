const DEVIN_BASE_URL = 'https://api.devin.ai';
const REQUEST_TIMEOUT_MS = 15_000;
// Tag para achar as sessões do Vigia no painel da Devin.
const SESSION_TAG = 'vigia';

export class DevinError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DevinError';
    this.code = code;
    // 502: o erro é de um serviço externo, não da requisição do usuário.
    this.status = 502;
    this.expose = true;
  }
}

const CLIENT_ERRORS = {
  401: ['DEVIN_AUTH', 'A chave da Devin é inválida ou não tem permissão para criar sessões.'],
  403: ['DEVIN_AUTH', 'A chave da Devin é inválida ou não tem permissão para criar sessões.'],
  402: ['DEVIN_LIMITE', 'A conta da Devin está sem créditos ou no limite de uso.'],
  429: ['DEVIN_LIMITE', 'A conta da Devin está sem créditos ou no limite de uso.'],
};

function statusError(status) {
  if (status >= 500) {
    return new DevinError('DEVIN_INDISPONIVEL', 'A Devin está indisponível no momento.');
  }
  const [code, message] = CLIENT_ERRORS[status] ?? [
    'DEVIN_REQUISICAO',
    'A Devin recusou a requisição.',
  ];
  return new DevinError(code, message);
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Cliente da API v3 da Devin. Só cria sessões de análise: nunca aponta
 * repositório, nunca aprova ações automaticamente e tem teto de ACUs.
 *
 * Não há retentativa: cada POST cria uma sessão e consome créditos. Repetir
 * uma requisição que deu timeout pode criar duas sessões para o mesmo alerta.
 */
export function createDevinClient({
  apiKey,
  orgId,
  maxAcuLimit,
  fetchImpl = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  baseUrl = DEVIN_BASE_URL,
}) {
  const endpoint = `${baseUrl}/v3/organizations/${encodeURIComponent(orgId)}/sessions`;

  async function createAnalysisSession({ prompt, title }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          title,
          tags: [SESSION_TAG],
          // Sem aprovação automática: qualquer ação do agente exige o usuário.
          bypass_approval: false,
          max_acu_limit: maxAcuLimit,
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw statusError(response.status);

      const payload = await response.json();
      if (typeof payload?.session_id !== 'string' || !isHttpsUrl(payload?.url)) {
        throw new DevinError('DEVIN_RESPOSTA_INVALIDA', 'A Devin devolveu uma resposta inesperada.');
      }

      // A URL vira link no painel: só aceitamos https, para não abrir esquemas perigosos.
      return { sessionId: payload.session_id, url: payload.url };
    } catch (error) {
      if (error instanceof DevinError) throw error;
      if (error.name === 'AbortError') {
        throw new DevinError('DEVIN_TIMEOUT', 'A Devin demorou demais para responder.');
      }
      if (error instanceof SyntaxError) {
        throw new DevinError('DEVIN_RESPOSTA_INVALIDA', 'A Devin devolveu uma resposta inesperada.');
      }
      throw new DevinError('DEVIN_REDE', 'Falha de rede ao falar com a Devin.');
    } finally {
      clearTimeout(timer);
    }
  }

  return { createAnalysisSession };
}
