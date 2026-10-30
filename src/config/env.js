import cron from 'node-cron';
import { z } from 'zod';

const DEFAULT_CRON = '*/15 * * * *';
const DEFAULT_FIRECRAWL_URL = 'https://api.firecrawl.dev';
const DEFAULT_DEVIN_ACU_LIMIT = 2;
const DEFAULT_DATABASE_PATH = './data/vigia.db';

// Diferencia "variável ausente" de "valor inválido" para a mensagem ficar clara.
const fieldError = (detail) => ({
  error: (issue) => (issue.input === undefined ? 'variável ausente' : detail),
});

const envSchema = z.object({
  FIRECRAWL_API_KEY: z.string(fieldError('deve ser um texto')).min(1, 'não pode ser vazia'),
  FIRECRAWL_BASE_URL: z
    .url({ protocol: /^https?$/ })
    .default(DEFAULT_FIRECRAWL_URL),
  RESEND_API_KEY: z.string(fieldError('deve ser um texto')).min(1, 'não pode ser vazia'),
  ALERT_EMAIL_FROM: z.string(fieldError('deve ser um texto')).min(1, 'não pode ser vazia'),
  ALERT_EMAIL_TO: z.email(fieldError('deve ser um e-mail válido')),
  DEVIN_API_KEY: z.string(fieldError('deve ser um texto')).min(1, 'não pode ser vazia'),
  DEVIN_ORG_ID: z
    .string(fieldError('deve ser um texto'))
    .regex(/^org-[\w-]+$/, 'deve começar com "org-" (veja Settings > Devin API)'),
  // Teto de consumo por análise: uma análise nunca custa mais do que isto.
  DEVIN_MAX_ACU_LIMIT: z.coerce
    .number()
    .int('deve ser um número inteiro')
    .min(1, 'deve ser pelo menos 1')
    .max(10, 'deve ser no máximo 10')
    .default(DEFAULT_DEVIN_ACU_LIMIT),
  CHECK_CRON: z
    .string()
    .default(DEFAULT_CRON)
    .refine((expression) => cron.validate(expression), 'expressão cron inválida'),
  DATABASE_PATH: z.string().min(1).default(DEFAULT_DATABASE_PATH),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export class ConfigError extends Error {
  constructor(problems) {
    super(
      `Configuração inválida. Corrija o arquivo .env:\n${problems
        .map((problem) => `  - ${problem}`)
        .join('\n')}`,
    );
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/**
 * Valida as variáveis de ambiente de uma vez, para que o usuário veja
 * todos os problemas de uma só vez, e não um por reinício.
 * Não grava valores no erro: segredos nunca devem aparecer em log.
 */
export function loadConfig(env = process.env) {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new ConfigError(problems);
  }
  return result.data;
}
