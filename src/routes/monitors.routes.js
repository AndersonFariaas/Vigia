import { Router } from 'express';
import { z } from 'zod';
import { validateMonitorUrl } from '../security/urlValidator.js';
import { CHECK_STATUS } from '../services/checker.js';

const MIN_INTERVAL_MINUTES = 15;
const MAX_INTERVAL_MINUTES = 1440;
const DEFAULT_INTERVAL_MINUTES = 60;
const HISTORY_LIMIT = 20;
const MAX_LABEL_LENGTH = 80;
// IDs são inteiros positivos. Qualquer outra coisa é rejeitada antes de tocar no banco.
const ID_PATTERN = /^[1-9]\d{0,9}$/;

export class ValidationError extends Error {
  constructor(details) {
    super('Dados inválidos.');
    this.name = 'ValidationError';
    this.status = 400;
    this.expose = true;
    this.details = details;
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

function parseBody(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((issue) => issue.message));
  }
  return result.data;
}

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
  };
}

const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

/**
 * Rotas de monitores. Todas usam `ownerId`: na Fase 1 é a conta única, mas o
 * filtro já está aqui para a Fase 3 trocar só a origem do id.
 */
export function createMonitorsRouter({ repos, ownerId, checkMonitor, assertPublicUrl }) {
  const router = Router();
  const { monitors, snapshots, alerts } = repos;

  // Busca o monitor do dono ou responde 404. Retorna null quando não achou.
  function findOwnedMonitor(req, res) {
    const id = parseId(req.params.id);
    const monitor = monitors.findByIdForUser(ownerId, id);
    if (!monitor) {
      res.status(404).json({ error: 'Monitor não encontrado.' });
      return null;
    }
    return monitor;
  }

  router.get('/', (req, res) => {
    res.json(monitors.listByUser(ownerId).map(toMonitorDto));
  });

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = parseBody(createBodySchema, req.body);
      const url = validateMonitorUrl(body.url);
      await assertPublicUrl(url);

      const monitor = monitors.create({
        userId: ownerId,
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

      const updated = monitors.findByIdForUser(ownerId, monitor.id);
      res.json({ result, monitor: toMonitorDto(updated) });
    }),
  );

  router.get('/:id/snapshots', (req, res) => {
    const monitor = findOwnedMonitor(req, res);
    if (!monitor) return;
    res.json(snapshots.listForUser(ownerId, monitor.id, HISTORY_LIMIT).map(toSnapshotDto));
  });

  router.get('/:id/alerts', (req, res) => {
    const monitor = findOwnedMonitor(req, res);
    if (!monitor) return;
    res.json(alerts.listForUser(ownerId, monitor.id, HISTORY_LIMIT).map(toAlertDto));
  });

  router.delete('/:id', (req, res) => {
    const monitor = findOwnedMonitor(req, res);
    if (!monitor) return;
    // ON DELETE CASCADE remove snapshots e alertas junto.
    monitors.deleteForUser(ownerId, monitor.id);
    res.status(204).end();
  });

  return router;
}
