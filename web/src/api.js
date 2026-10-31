const BASE_URL = '/api';
// Avisa o painel quando a sessão cai no meio do uso. Quem escuta decide o que mostrar.
export const SESSION_EXPIRED_EVENT = 'vigia:sessao-expirada';

export class ApiError extends Error {
  constructor(message, status, details = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

/** Texto para mostrar à pessoa. Detalhes de validação já vêm legíveis e têm prioridade. */
export function messageOf(error) {
  if (error instanceof ApiError && error.details.length) return error.details.join(' ');
  return error.message;
}

/**
 * Chamada à API. Erros chegam já sanitizados pelo servidor: a mensagem
 * exibida é sempre a que a API devolve em `error`, nunca um erro cru do navegador.
 */
async function request(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Não foi possível conectar à API. Verifique se o servidor está rodando.', 0);
  }

  if (response.status === 204) return null;

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    // 401 fora das rotas de conta significa que a sessão acabou.
    if (response.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    throw new ApiError(data?.error ?? 'Erro inesperado. Tente novamente.', response.status, data?.details ?? []);
  }
  return data;
}

export const api = {
  health: () => request('/health'),
  session: () => request('/auth/sessao'),
  register: (payload) => request('/auth/cadastro', { method: 'POST', body: payload }),
  login: (payload) => request('/auth/entrar', { method: 'POST', body: payload }),
  logout: () => request('/auth/sair', { method: 'POST' }),
  updateAccount: (payload) => request('/auth/conta', { method: 'PATCH', body: payload }),
  deleteAccount: (senhaAtual) => request('/auth/conta', { method: 'DELETE', body: { senhaAtual } }),
  listMonitors: () => request('/monitors'),
  createMonitor: (payload) => request('/monitors', { method: 'POST', body: payload }),
  checkMonitor: (id) => request(`/monitors/${id}/check`, { method: 'POST' }),
  listAlerts: (id) => request(`/monitors/${id}/alerts`),
  deleteMonitor: (id) => request(`/monitors/${id}`, { method: 'DELETE' }),
  analyzeAlert: (monitorId, alertId) =>
    request(`/monitors/${monitorId}/alerts/${alertId}/analyze`, { method: 'POST' }),
};
