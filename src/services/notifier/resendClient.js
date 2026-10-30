const RESEND_URL = 'https://api.resend.com/emails';
const REQUEST_TIMEOUT_MS = 15_000;

export class EmailError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EmailError';
    this.code = code;
  }
}

function statusToError(status) {
  if (status === 401 || status === 403) {
    return new EmailError('RESEND_AUTH', 'Chave da Resend inválida ou sem permissão.');
  }
  if (status === 422) {
    return new EmailError('RESEND_REJEITADO', 'A Resend rejeitou o e-mail (verifique o remetente).');
  }
  if (status === 429) {
    return new EmailError('RESEND_LIMITE', 'Limite de envio da Resend atingido.');
  }
  return new EmailError('RESEND_FALHA', 'A Resend não conseguiu enviar o e-mail.');
}

/**
 * Cliente mínimo da Resend. O corpo da resposta de erro nunca entra na exceção:
 * ele pode ecoar o e-mail ou dados da conta.
 */
export function createResendClient({ apiKey, from, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS }) {
  return async function send({ to, subject, html, text }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(RESEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to, subject, html, text }),
        signal: controller.signal,
      });

      if (!response.ok) throw statusToError(response.status);

      const payload = await response.json();
      return { id: payload?.id ?? null };
    } catch (error) {
      if (error instanceof EmailError) throw error;
      if (error.name === 'AbortError') {
        throw new EmailError('RESEND_TIMEOUT', 'A Resend demorou demais para responder.');
      }
      throw new EmailError('RESEND_REDE', 'Falha de rede ao falar com a Resend.');
    } finally {
      clearTimeout(timer);
    }
  };
}
