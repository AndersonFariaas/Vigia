import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parseBody, ValidationError } from '../http.js';
import { validateMonitorUrl } from '../security/urlValidator.js';
import { CHECK_STATUS } from '../services/checker.js';
import { buildAnalysisPrompt } from '../services/analyst/analysisPrompt.js';

const MIN_INTERVAL_MINUTES = 15;
const MAX_INTERVAL_MINUTES = 1440;
const DEFAULT_INTERVAL_MINUTES = 60;
const HISTORY_LIMIT = 20;
const MAX_LABEL_LENGTH = 80;
// Cada página é uma checagem a cada intervalo, com créditos da Firecrawl e, ao analisar, da Devin.
export const MAX_MONITORS_PER_USER = 20;
// IDs são inteiros positivos. Qualquer outra coisa é rejeitada antes de tocar no banco.
const ID_PATTERN = /^[1-9]\d{0,9}$/;

class QuotaError extends Error {
  constructor() {
    super(`Você já atingiu o limite de ${MAX_MONITORS_PER_USER} páginas monitoradas.`);
    this.name = 'QuotaError';
    this.status = 409;
    this.expose = true;
  }
}

const createBodySchema = z.strictObject({
  url: z.string({ error: 'Informe a URL da página.' }),
  label: z
    .string()
    .trim()
    .max(MAX_LABEL_LENGTH, `O nome pode ter no máximo ${MAX_LABEL_LENGTH} caracteres.`)
    .optional(),
  intervalMinutes: z
    .number({ error: 'A frequência deve ser um número.' })
    .int('A frequência deve ser um número inteiro de minutos.')
    .min(MIN_INTERVAL_MINUTES, `A frequência mínima é de ${MIN_INTERVAL_MINUTES} minutos.`)
    .max(MAX_INTERVAL_MINUTES, `A frequência máxima é de ${MAX_INTERVAL_MINUTES} minutos.`)
    .default(DEFAULT_INTERVAL_MINUTES),
});

function parseId(raw) {
  if (!ID_PATTERN.test(raw)) throw new ValidationError(['ID inválido.']);
  return Number(raw);
}

// Expõe só o necessário: user_id e campos internos não saem da API.
export function toMonitorDto(row) {
  return {
    id: row.id,
    url: row.url,
    label: row.label,
    intervalMinutes: row.interval_minutes,
    active: row.active === 1,
    lastCheckedAt: row.last_checked_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

function toSnapshotDto(row) {
  return { id: row.id, contentHash: row.content_hash, createdAt: row.created_at };
}

function toAlertDto(row) {
  return {
    id: row.id,
    kind: row.kind,
    severity: row.severity,
    details: row.details,
    sendStatus: row.send_status,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    analysis: row.analysis,
  };
}

function toAnalysisDto(row) {
  return { sessionId: row.session_id, sessionUrl: row.session_url, createdAt: row.created_at };
}

/**
 * Rotas de monitores. Todas exigem sessão (o middleware roda antes) e filtram por `req.user.id`:
 * um usuário nunca enxerga nem altera o monitor de outro.
 */
export function createMonitorsRouter({ repos, checkMonitor, assertPublicUrl, analyst }) {
  const router = Router();
  const { monitors, snapshots, alerts, analyses } = repos;
  // Duplo clique não pode criar duas sessões (e duas cobranças) para o mesmo alerta.
  const analysesInFlight = new Set();

  // Busca o monitor do dono ou responde 404. Retorna null quando não achou.
  function findOwnedMonitor(req, res) {
    const id = parseId(req.params.id);
    const monitor = monitors.findByIdForUser(req.user.id, id);
    if (!monitor) {
      res.status(404).json({ error: 'Monitor não encontrado.' });
      return null;
    }
    return monitor;
  }

  router.get('/', (req, res) => {
    res.json(monitors.listByUser(req.user.id).map(toMonitorDto));
  });

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = parseBody(createBodySchema, req.body);
      const userId = req.user.id;
      const url = validateMonitorUrl(body.url);
      await assertPublicUrl(url);

      // Conferida depois do await: duas criações ao mesmo tempo não podem passar do limite juntas.
      if (monitors.listByUser(userId).length >= MAX_MONITORS_PER_USER) throw new QuotaError();

      const monitor = monitors.create({
        userId,
        url,
        label: body.label || null,
        intervalMinutes: body.intervalMinutes,
      });
      res.status(201).json(toMonitorDto(monitor));
    }),
  );

  router.post(
    '/:id/check',
    asyncHandler(async (req, res) => {
      const monitor = findOwnedMonitor(req, res);
      if (!monitor) return;

      const result = await checkMonitor(monitor);
      if (result.status === CHECK_STATUS.EM_ANDAMENTO) {
        res.status(409).json({ error: 'Esta página já está sendo verificada.' });
        return;
      }

      const updated = monitors.findByIdForUser(req.user.id, monitor.id);
      res.json({ result, monitor: toMonitorDto(updated) });
    }),
  );

  router.get('/:id/snapshots', (req, res) => {
    const monitor = findOwnedMonitor(req, res);
    if (!monitor) return;
    res.json(snapshots.listForUser(req.user.id, monitor.id, HISTORY_LIMIT).map(toSnapshotDto));
  });

  router.get('/:id/alerts', (req, res) => {
    const monitor = findOwnedMonitor(req, res);
    if (!monitor) return;
    res.json(alerts.listForUser(req.user.id, monitor.id, HISTORY_LIMIT).map(toAlertDto));
  });

  router.post(
    '/:id/alerts/:alertId/analyze',
    asyncHandler(async (req, res) => {
      const monitor = findOwnedMonitor(req, res);
      if (!monitor) return;

      const alertId = parseId(req.params.alertId);
      const alert = alerts.findForUser(req.user.id, alertId);
      if (!alert || alert.monitor_id !== monitor.id) {
        res.status(404).json({ error: 'Alerta não encontrado.' });
        return;
      }

      // Já analisado: devolve a sessão existente em vez de cobrar de novo.
      const existing = analyses.findByAlertId(alertId);
      if (existing) {
        res.json(toAnalysisDto(existing));
        return;
      }

      if (analysesInFlight.has(alertId)) {
        res.status(409).json({ error: 'A análise deste alerta já está sendo criada.' });
        return;
      }

      analysesInFlight.add(alertId);
      try {
        const prompt = buildAnalysisPrompt({ monitor, details: alert.details });
        const session = await analyst.createAnalysisSession({
          prompt,
          title: `Vigia: alerta #${alertId}`,
        });
        analyses.insert({ alertId, sessionId: session.sessionId, sessionUrl: session.url });
        res.status(201).json(toAnalysisDto(analyses.findByAlertId(alertId)));
      } finally {
        analysesInFlight.delete(alertId);
      }
    }),
  );

  router.delete('/:id', (req, res) => {
    const monitor = findOwnedMonitor(req, res);
    if (!monitor) return;
    // ON DELETE CASCADE remove snapshots e alertas junto.
    monitors.deleteForUser(req.user.id, monitor.id);
    res.status(204).end();
  });

  return router;
}
