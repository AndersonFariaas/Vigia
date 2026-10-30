import { assertPublicHost } from '../security/ssrfGuard.js';
import { validateMonitorUrl } from '../security/urlValidator.js';
import { withTransaction } from '../db/index.js';
import { MAX_SNAPSHOTS_PER_MONITOR } from '../db/repositories/snapshots.js';
import { sha256 } from './diff/hash.js';
import { diffLines } from './diff/textDiff.js';
import { normalizeText } from './scraper/normalize.js';

export const CHECK_STATUS = Object.freeze({
  REFERENCIA: 'referencia',
  OK: 'ok',
  ALTERADO: 'alterado',
  ERRO: 'erro',
  EM_ANDAMENTO: 'em_andamento',
});

const ALERT_KIND = 'alteracao_conteudo';
// Placeholder da Fase 1: a Fase 2 classifica a severidade de verdade.
const ALERT_SEVERITY = 'media';

class EmptyContentError extends Error {
  constructor() {
    super('A página não retornou conteúdo legível.');
    this.code = 'CONTEUDO_VAZIO';
  }
}

// Erros que o usuário já entende. Qualquer código fora desta lista vira mensagem genérica.
const SAFE_MESSAGES = {
  URL_INVALIDA: 'A URL não é permitida. Confira o endereço.',
  SSRF_BLOCKED: 'Endereço não permitido: o domínio aponta para uma rede privada ou interna.',
  DNS_FALHOU: 'Não foi possível resolver o domínio.',
  CONTEUDO_VAZIO: 'A página não retornou conteúdo legível.',
  FIRECRAWL_AUTH: 'Chave da Firecrawl inválida ou sem permissão.',
  FIRECRAWL_SEM_CREDITO: 'Sem créditos na Firecrawl. Verifique o plano da conta.',
  FIRECRAWL_LIMITE: 'Limite de requisições da Firecrawl atingido. Tente mais tarde.',
  FIRECRAWL_INDISPONIVEL: 'A Firecrawl está indisponível no momento.',
  FIRECRAWL_TIMEOUT: 'A Firecrawl demorou demais para responder.',
  FIRECRAWL_REDE: 'Falha de rede ao falar com a Firecrawl.',
  FIRECRAWL_REQUISICAO: 'A Firecrawl recusou a requisição.',
  FIRECRAWL_RESPOSTA_INVALIDA: 'A Firecrawl não conseguiu extrair a página.',
};

const GENERIC_MESSAGE = 'Erro inesperado ao verificar a página.';

/** Traduz um erro para texto seguro de gravar e mostrar. Nunca devolve a mensagem crua. */
export function toSafeMessage(error) {
  return SAFE_MESSAGES[error?.code] ?? GENERIC_MESSAGE;
}

/**
 * Fluxo de uma checagem: URL → SSRF → raspagem → normalização → hash → comparação.
 * Todas as dependências entram por parâmetro, então os testes rodam sem rede.
 */
export function createChecker({
  db,
  monitors,
  snapshots,
  alerts,
  scrape,
  assertPublicUrl = (url) => assertPublicHost(new URL(url).hostname),
  now = () => new Date(),
  log = () => {},
}) {
  // Duas checagens do mesmo monitor (manual + agendador) gerariam alertas duplicados.
  const inFlight = new Set();

  async function fetchNormalizedText(url) {
    await assertPublicUrl(url);
    const { markdown } = await scrape(url);
    const text = normalizeText(markdown);
    if (!text) throw new EmptyContentError();
    return text;
  }

  function compareWithLatest(monitor, text, checkedAt) {
    const hash = sha256(text);
    const previous = snapshots.findLatest(monitor.id);
    const record = (status, error = null) =>
      monitors.updateCheckResult(monitor.user_id, monitor.id, { checkedAt, status, error });

    // Primeira leitura: vira referência, sem alerta.
    if (!previous) {
      snapshots.insert({ monitorId: monitor.id, contentHash: hash, normalizedText: text });
      record(CHECK_STATUS.REFERENCIA);
      return { status: CHECK_STATUS.REFERENCIA };
    }

    if (previous.content_hash === hash) {
      record(CHECK_STATUS.OK);
      return { status: CHECK_STATUS.OK };
    }

    const details = diffLines(previous.normalized_text, text);
    snapshots.insert({ monitorId: monitor.id, contentHash: hash, normalizedText: text });
    snapshots.pruneKeeping(monitor.id, MAX_SNAPSHOTS_PER_MONITOR);
    const alertId = alerts.insert({
      monitorId: monitor.id,
      kind: ALERT_KIND,
      severity: ALERT_SEVERITY,
      details,
    });
    record(CHECK_STATUS.ALTERADO);
    return { status: CHECK_STATUS.ALTERADO, alertId };
  }

  return async function checkMonitor(monitor) {
    if (inFlight.has(monitor.id)) return { status: CHECK_STATUS.EM_ANDAMENTO };

    inFlight.add(monitor.id);
    const checkedAt = now().toISOString();
    try {
      const url = validateMonitorUrl(monitor.url);
      const text = await fetchNormalizedText(url);
      return withTransaction(db, () => compareWithLatest(monitor, text, checkedAt));
    } catch (error) {
      if (!SAFE_MESSAGES[error?.code]) {
        log('error', `Erro inesperado na checagem do monitor ${monitor.id}: ${error?.name ?? 'Erro'}`);
      }
      const message = toSafeMessage(error);
      monitors.updateCheckResult(monitor.user_id, monitor.id, {
        checkedAt,
        status: CHECK_STATUS.ERRO,
        error: message,
      });
      return { status: CHECK_STATUS.ERRO, message };
    } finally {
      inFlight.delete(monitor.id);
    }
  };
}
