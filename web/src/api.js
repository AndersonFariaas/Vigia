const BASE_URL = '/api';

export class ApiError extends Error {
  constructor(message, status, details = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
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
    throw new ApiError(data?.error ?? 'Erro inesperado. Tente novamente.', response.status, data?.details ?? []);
  }
  return data;
}

export const api = {
  health: () => request('/health'),
  listMonitors: () => request('/monitors'),
  createMonitor: (payload) => request('/monitors', { method: 'POST', body: payload }),
  checkMonitor: (id) => request(`/monitors/${id}/check`, { method: 'POST' }),
  listAlerts: (id) => request(`/monitors/${id}/alerts`),
  deleteMonitor: (id) => request(`/monitors/${id}`, { method: 'DELETE' }),
};
