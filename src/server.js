import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config/env.js';
import { openDatabase } from './db/index.js';
import { applyMigrations } from './db/migrate.js';
import { createAlertsRepository } from './db/repositories/alerts.js';
import { createMonitorsRepository } from './db/repositories/monitors.js';
import { createSnapshotsRepository } from './db/repositories/snapshots.js';
import { ensureOwner } from './db/repositories/users.js';
import { assertPublicHost } from './security/ssrfGuard.js';
import { createChecker } from './services/checker.js';
import { createFirecrawlClient } from './services/scraper/firecrawlClient.js';
import { createDispatcher } from './services/notifier/dispatcher.js';
import { createResendClient } from './services/notifier/resendClient.js';
import { createRoundRunner, startScheduler } from './services/scheduler/jobs.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const WEB_DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');

function log(level, message) {
  const line = `[vigia] ${level.toUpperCase()} ${message}`;
  if (level === 'error') console.error(line);
  else console.log(line);
}

async function main() {
  // Carrega o .env do diretório atual, se existir. Variáveis já definidas no ambiente vencem.
  if (existsSync('.env')) process.loadEnvFile('.env');

  const config = loadConfig(process.env);

  const db = openDatabase(config.DATABASE_PATH);
  applyMigrations(db);
  const ownerId = ensureOwner(db, config.ALERT_EMAIL_TO);

  const repos = {
    monitors: createMonitorsRepository(db),
    snapshots: createSnapshotsRepository(db),
    alerts: createAlertsRepository(db),
  };

  const scrape = createFirecrawlClient({
    apiKey: config.FIRECRAWL_API_KEY,
    baseUrl: config.FIRECRAWL_BASE_URL,
  });
  const resend = createResendClient({
    apiKey: config.RESEND_API_KEY,
    from: config.ALERT_EMAIL_FROM,
  });

  const assertPublicUrl = (url) => assertPublicHost(new URL(url).hostname);
  const checkMonitor = createChecker({ db, ...repos, scrape, assertPublicUrl, log });
  const dispatchPending = createDispatcher({
    alerts: repos.alerts,
    sendEmail: (message) => resend({ to: config.ALERT_EMAIL_TO, ...message }),
    log,
  });
  const runRound = createRoundRunner({
    // Só o agendador usa findByIdUnscoped; a lista de vencidos não vem de rota.
    findDue: (limit) => repos.monitors.findDue(new Date().toISOString(), limit),
    checkMonitor,
    dispatchPending,
    log,
  });
  const scheduler = startScheduler({ expression: config.CHECK_CRON, runRound, log });

  const isProduction = process.env.NODE_ENV === 'production';
  const staticDir = isProduction && existsSync(WEB_DIST) ? WEB_DIST : null;
  if (isProduction && !staticDir) {
    log('warn', 'web/dist não encontrado. Rode "npm run web:build" para servir o painel.');
  }

  const app = createApp({ repos, ownerId, checkMonitor, assertPublicUrl, staticDir, log });

  if (!LOOPBACK_HOSTS.has(config.HOST)) {
    log(
      'warn',
      `HOST=${config.HOST} expõe o Vigia na rede. A Fase 1 NÃO tem autenticação: não exponha na internet.`,
    );
  }

  const server = app.listen(config.PORT, config.HOST, () => {
    log('info', `Servidor em http://${config.HOST}:${config.PORT} (checagem: "${config.CHECK_CRON}")`);
  });

  const shutdown = () => {
    scheduler.stop();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((error) => {
  if (error instanceof ConfigError) {
    console.error(error.message);
  } else {
    // Só o nome do erro: a mensagem crua pode trazer caminhos ou dados sensíveis.
    console.error(`[vigia] ERROR Falha ao iniciar: ${error.name}`);
  }
  process.exit(1);
});
