import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createMonitorsRouter } from './routes/monitors.routes.js';
import { createAuthRouter, requireAuth } from './routes/auth.routes.js';

const JSON_BODY_LIMIT = '10kb';
// Teto geral da API por IP. Uma ação do painel faz poucas chamadas, então o limite é folgado.
const API_WINDOW_MS = 15 * 60 * 1000;
const API_REQUESTS_PER_WINDOW = 600;

// Uma linha por requisição da API: método, caminho, status e duração. Sem query, cabeçalhos ou corpo.
function requestLogger(log) {
  return (req, res, next) => {
    // O caminho é guardado agora: rotas montadas (app.use('/api/x')) mudam req.path no meio do caminho.
    const { method, path } = req;
    if (!path.startsWith('/api')) return next();
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      log('info', 'requisicao', {
        method,
        path,
        status: res.statusCode,
        durationMs: Math.round(durationMs),
      });
    });
    return next();
  };
}

function apiLimiter(overrides) {
  return rateLimit({
    windowMs: API_WINDOW_MS,
    limit: API_REQUESTS_PER_WINDOW,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Muitas requisições. Aguarde alguns minutos e tente de novo.' },
    ...overrides,
  });
}

function errorHandler(log) {
  // Quatro parâmetros são obrigatórios: é assim que o Express reconhece um handler de erro.
  return (error, req, res, next) => {
    if (res.headersSent) return next(error);

    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'JSON malformado.' });
    }
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ error: `O corpo da requisição excede ${JSON_BODY_LIMIT}.` });
    }
    // Erros de serviços externos (status 5xx) também são seguros de exibir: já vêm sanitizados.
    if (error.expose && error.status >= 400 && error.status < 600) {
      return res.status(error.status).json({
        error: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
    }

    log('error', `Erro interno na requisição: ${error.name}`);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  };
}

/**
 * Monta o Express sem subir o servidor, para os testes usarem uma instância própria.
 * `staticDir` só é passado em produção: em desenvolvimento quem serve o painel é o Vite.
 * `secureCookies` liga o atributo Secure do cookie de sessão (use em produção com HTTPS).
 */
export function createApp({
  repos,
  auth,
  checkMonitor,
  assertPublicUrl,
  analyst,
  secureCookies = false,
  trustProxy = false,
  registrationOpen = true,
  loginLimit = {},
  apiLimit = {},
  staticDir = null,
  log = () => {},
}) {
  const app = express();
  app.disable('x-powered-by');
  // Com proxy na frente, o IP do cliente é o primeiro salto do cabeçalho X-Forwarded-For.
  if (trustProxy) app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(requestLogger(log));
  app.use('/api', apiLimiter(apiLimit));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', createAuthRouter({ auth, secureCookies, registrationOpen, loginLimit }));

  app.use(
    '/api/monitors',
    requireAuth(auth),
    createMonitorsRouter({ repos, checkMonitor, assertPublicUrl, analyst }),
  );

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Rota não encontrada.' });
  });

  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: 'index.html' }));
    // Rotas do painel (ex.: /monitores) caem no index.html; /api nunca cai aqui.
    app.get(/^\/(?!api(?:\/|$)).*/, (req, res) => {
      res.sendFile(join(staticDir, 'index.html'));
    });
  }

  app.use((req, res) => {
    res.status(404).json({ error: 'Rota não encontrada.' });
  });

  app.use(errorHandler(log));
  return app;
}
