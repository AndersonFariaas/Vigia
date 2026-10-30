import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { createMonitorsRouter } from './routes/monitors.routes.js';

const JSON_BODY_LIMIT = '10kb';

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
 */
export function createApp({
  repos,
  ownerId,
  checkMonitor,
  assertPublicUrl,
  analyst,
  staticDir = null,
  log = () => {},
}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(
    '/api/monitors',
    createMonitorsRouter({ repos, ownerId, checkMonitor, assertPublicUrl, analyst }),
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
