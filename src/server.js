import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config/env.js';
import { openDatabase } from './db/index.js';
import { applyMigrations } from './db/migrate.js';
import { createAlertsRepository } from './db/repositories/alerts.js';
import { createAnalysesRepository } from './db/repositories/analyses.js';
import { createMonitorsRepository } from './db/repositories/monitors.js';
import { createSessionsRepository } from './db/repositories/sessions.js';
import { createSnapshotsRepository } from './db/repositories/snapshots.js';
import { createUsersRepository } from './db/repositories/users.js';
import { assertPublicHost } from './security/ssrfGuard.js';
import { createAuthService } from './services/auth/authService.js';
import { createChecker } from './services/checker.js';
import { createFirecrawlClient } from './services/scraper/firecrawlClient.js';
import { createDispatcher } from './services/notifier/dispatcher.js';
import { createResendClient } from './services/notifier/resendClient.js';
import { createDevinClient } from './services/analyst/devinClient.js';
import { createRoundRunner, startScheduler } from './services/scheduler/jobs.js';
import { createRetention } from './services/retention.js';

const DAY_MS = 24 * 60 * 60 * 1000;

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

  const repos = {
    users: createUsersRepository(db),
    sessions: createSessionsRepository(db),
    monitors: createMonitorsRepository(db),
    snapshots: createSnapshotsRepository(db),
    alerts: createAlertsRepository(db),
    analyses: createAnalysesRepository(db),
  };
  repos.sessions.deleteExpired(new Date().toISOString());
  const auth = createAuthService({ users: repos.users, sessions: repos.sessions });

  const scrape = createFirecrawlClient({
    apiKey: config.FIRECRAWL_API_KEY,
    baseUrl: config.FIRECRAWL_BASE_URL,
  });
  const resend = createResendClient({
    apiKey: config.RESEND_API_KEY,
    from: config.ALERT_EMAIL_FROM,
  });

  const analyst = createDevinClient({
    apiKey: config.DEVIN_API_KEY,
    orgId: config.DEVIN_ORG_ID,
    maxAcuLimit: config.DEVIN_MAX_ACU_LIMIT,
  });

  const assertPublicUrl = (url) => assertPublicHost(new URL(url).hostname);
  const checkMonitor = createChecker({ db, ...repos, scrape, assertPublicUrl, log });
  const dispatchPending = createDispatcher({
    alerts: repos.alerts,
    // O destinatário vem de cada alerta: é o e-mail do dono do monitor.
    sendEmail: (message) => resend(message),
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

  // Retenção de 90 dias: roda ao iniciar e depois uma vez por dia.
  const purgeExpiredData = createRetention({ snapshots: repos.snapshots, alerts: repos.alerts, log });
  purgeExpiredData();
  const retentionTimer = setInterval(purgeExpiredData, DAY_MS);
  retentionTimer.unref();

  const isProduction = process.env.NODE_ENV === 'production';
  const staticDir = isProduction && existsSync(WEB_DIST) ? WEB_DIST : null;
  if (isProduction && !staticDir) {
    log('warn', 'web/dist não encontrado. Rode "npm run web:build" para servir o painel.');
  }

  const app = createApp({
    repos,
    auth,
    checkMonitor,
    assertPublicUrl,
    analyst,
    secureCookies: isProduction,
    registrationOpen: config.CADASTRO_ABERTO,
    staticDir,
    log,
  });

  if (!LOOPBACK_HOSTS.has(config.HOST)) {
    log(
      'warn',
      `HOST=${config.HOST} expõe o Vigia na rede. Antes disso, coloque HTTPS na frente e revise o cadastro aberto.`,
    );
  }

  const server = app.listen(config.PORT, config.HOST, () => {
    log('info', `Servidor em http://${config.HOST}:${config.PORT} (checagem: "${config.CHECK_CRON}")`);
  });

  const shutdown = () => {
    scheduler.stop();
    clearInterval(retentionTimer);
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
