import { assertPublicHost } from '../security/ssrfGuard.js';
import { validateMonitorUrl } from '../security/urlValidator.js';
import { withTransaction } from '../db/index.js';
import { MAX_SNAPSHOTS_PER_MONITOR } from '../db/repositories/snapshots.js';
import { sha256 } from './diff/hash.js';
import { diffLines } from './diff/textDiff.js';
import { normalizeText } from './scraper/normalize.js';
import { readPageSignals } from './detectors/pageSignals.js';
import { buildRisks } from './detectors/risks.js';
import { readCertificateExpiry } from './detectors/certificate.js';

export const CHECK_STATUS = Object.freeze({
  REFERENCIA: 'referencia',
  OK: 'ok',
  ALTERADO: 'alterado',
  ERRO: 'erro',
  EM_ANDAMENTO: 'em_andamento',
});

const CONTENT_ALERT_KIND = 'alteracao_conteudo';
const RISK_ALERT_KIND = 'risco';
// Mudança de conteúdo mantém severidade fixa. Riscos trazem a própria severidade.
const CONTENT_ALERT_SEVERITY = 'media';

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
 * Fluxo de uma checagem: URL → SSRF → raspagem → normalização → hash → comparação,
 * com os detectores de risco rodando sobre o HTML da mesma leitura.
 * Todas as dependências entram por parâmetro, então os testes rodam sem rede.
 */
export function createChecker({
  db,
  monitors,
  snapshots,
  alerts,
  scrape,
  assertPublicUrl = (url) => assertPublicHost(new URL(url).hostname),
  inspectCertificate = readCertificateExpiry,
  now = () => new Date(),
  log = () => {},
}) {
  // Duas checagens do mesmo monitor (manual + agendador) gerariam alertas duplicados.
  const inFlight = new Set();

  async function fetchPage(url) {
    await assertPublicUrl(url);
    const { markdown, html } = await scrape(url);
    const text = normalizeText(markdown);
    if (!text) throw new EmptyContentError();
    return { text, html };
  }

  // Feito fora da transação: a leitura do certificado usa a rede.
  async function analyzePage(url, html) {
    const { hostname, protocol } = new URL(url);
    const certificateValidTo = protocol === 'https:' ? await inspectCertificate(hostname) : null;
    const details = readPageSignals({ html, pageUrl: url });
    const risks = buildRisks({ signals: details, pageUrl: url, certificateValidTo, now: now() });

    // Guardar as chaves dos riscos permite alertar só os que são novos na próxima leitura.
    const signals = { ...details, certificateValidTo, riscos: risks.map((risk) => risk.key) };
    return { signals, risks };
  }

  function insertRiskAlert(monitorId, risk) {
    return alerts.insert({
      monitorId,
      kind: RISK_ALERT_KIND,
      severity: risk.severity,
      details: { chave: risk.key, titulo: risk.title, descricao: risk.description },
    });
  }

  function compareWithLatest(monitor, page, checkedAt) {
    const hash = sha256(page.text);
    const previous = snapshots.findLatest(monitor.id);
    const record = (status, error = null) =>
      monitors.updateCheckResult(monitor.user_id, monitor.id, { checkedAt, status, error });
    const saveSnapshot = () => {
      snapshots.insert({
        monitorId: monitor.id,
        contentHash: hash,
        normalizedText: page.text,
        signals: page.signals,
      });
      snapshots.pruneKeeping(monitor.id, MAX_SNAPSHOTS_PER_MONITOR);
    };

    // Primeira leitura: vira referência. Riscos que já valem de início também alertam.
    if (!previous) {
      saveSnapshot();
      const alertIds = page.risks
        .filter((risk) => risk.baseline)
        .map((risk) => insertRiskAlert(monitor.id, risk));
      const status = alertIds.length ? CHECK_STATUS.ALTERADO : CHECK_STATUS.REFERENCIA;
      record(status);
      return { status, alertIds };
    }

    const textChanged = previous.content_hash !== hash;
    const signalsChanged = JSON.stringify(page.signals) !== JSON.stringify(previous.signals);
    if (!textChanged && !signalsChanged) {
      record(CHECK_STATUS.OK);
      return { status: CHECK_STATUS.OK, alertIds: [] };
    }

    // Leituras anteriores à Fase 2 não guardam riscos: nesse caso nada é "novo", só se registra.
    const previousKeys = previous.signals.riscos ? new Set(previous.signals.riscos) : null;
    const newRisks = previousKeys ? page.risks.filter((risk) => !previousKeys.has(risk.key)) : [];

    const alertIds = [];
    if (textChanged) {
      const details = diffLines(previous.normalized_text, page.text);
      alertIds.push(
        alerts.insert({
          monitorId: monitor.id,
          kind: CONTENT_ALERT_KIND,
          severity: CONTENT_ALERT_SEVERITY,
          details,
        }),
      );
    }
    for (const risk of newRisks) alertIds.push(insertRiskAlert(monitor.id, risk));

    saveSnapshot();
    const status = alertIds.length ? CHECK_STATUS.ALTERADO : CHECK_STATUS.OK;
    record(status);
    return { status, alertIds };
  }

  return async function checkMonitor(monitor) {
    if (inFlight.has(monitor.id)) return { status: CHECK_STATUS.EM_ANDAMENTO };

    inFlight.add(monitor.id);
    const checkedAt = now().toISOString();
    try {
      const url = validateMonitorUrl(monitor.url);
      const { text, html } = await fetchPage(url);
      const page = { text, ...(await analyzePage(url, html)) };
      return withTransaction(db, () => compareWithLatest(monitor, page, checkedAt));
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
