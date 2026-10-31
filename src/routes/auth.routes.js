import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler, parseBody } from '../http.js';
import { TERMS_VERSION } from '../legal/termos.js';
import { SESSION_COOKIE, SESSION_DAYS } from '../security/sessionToken.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 10;
// Limite alto de propósito: o scrypt é caro, e um corpo gigante não pode virar um custo sem fim.
const MAX_PASSWORD_LENGTH = 128;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPTS_PER_WINDOW = 10;

const emailSchema = z
  .string({ error: 'Informe o e-mail.' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Informe um e-mail válido.' }));

const NAME_MIN_LENGTH = 2;
const NAME_MAX_LENGTH = 80;

const registerSchema = z.strictObject({
  nome: z
    .string({ error: 'Informe seu nome.' })
    .trim()
    .min(NAME_MIN_LENGTH, `O nome deve ter pelo menos ${NAME_MIN_LENGTH} caracteres.`)
    .max(NAME_MAX_LENGTH, `O nome pode ter no máximo ${NAME_MAX_LENGTH} caracteres.`),
  email: emailSchema,
  password: z
    .string({ error: 'Informe a senha.' })
    .min(MIN_PASSWORD_LENGTH, `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`)
    .max(MAX_PASSWORD_LENGTH, `A senha pode ter no máximo ${MAX_PASSWORD_LENGTH} caracteres.`),
  // O aceite é obrigatório: sem ele a conta não é criada.
  aceitouTermos: z.literal(true, {
    error: 'Você precisa aceitar os Termos de Uso e a Política de Privacidade.',
  }),
});

const deleteAccountSchema = z.strictObject({
  senhaAtual: z
    .string({ error: 'Informe a senha atual para excluir a conta.' })
    .min(1, 'Informe a senha atual para excluir a conta.')
    .max(MAX_PASSWORD_LENGTH),
});

const loginSchema = z.strictObject({
  email: emailSchema,
  password: z
    .string({ error: 'Informe a senha.' })
    .min(1, 'Informe a senha.')
    .max(MAX_PASSWORD_LENGTH, 'E-mail ou senha inválidos.'),
});

const accountSchema = z.strictObject({
  nome: z
    .string({ error: 'Informe seu nome.' })
    .trim()
    .min(NAME_MIN_LENGTH, `O nome deve ter pelo menos ${NAME_MIN_LENGTH} caracteres.`)
    .max(NAME_MAX_LENGTH, `O nome pode ter no máximo ${NAME_MAX_LENGTH} caracteres.`)
    .optional(),
  email: emailSchema.optional(),
  senhaAtual: z.string({ error: 'Informe a senha atual.' }).min(1, 'Informe a senha atual.').max(MAX_PASSWORD_LENGTH).optional(),
  novaSenha: z
    .string({ error: 'Informe a nova senha.' })
    .min(MIN_PASSWORD_LENGTH, `A nova senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`)
    .max(MAX_PASSWORD_LENGTH, `A nova senha pode ter no máximo ${MAX_PASSWORD_LENGTH} caracteres.`)
    .optional(),
});

function cookieOptions(secure) {
  return {
    httpOnly: true,
    // Strict: o navegador não manda o cookie em pedidos vindos de outros sites (proteção contra CSRF).
    sameSite: 'strict',
    secure,
    path: '/',
    maxAge: SESSION_DAYS * DAY_MS,
  };
}

/** Lê o token do cookie de sessão, sem depender de um parser externo. */
export function readSessionToken(req) {
  const prefix = `${SESSION_COOKIE}=`;
  const pair = (req.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return pair ? pair.slice(prefix.length) || null : null;
}

/** Protege uma rota: sem sessão válida, responde 401. Com sessão, expõe req.user. */
export function requireAuth(auth) {
  return (req, res, next) => {
    const token = readSessionToken(req);
    const user = token ? auth.userForToken(token) : null;
    if (!user) {
      res.status(401).json({ error: 'Entre na sua conta para continuar.' });
      return;
    }
    req.user = user;
    next();
  };
}

export function createAuthRouter({ auth, secureCookies = false, registrationOpen = true, loginLimit = {} }) {
  const router = Router();

  // Por IP. Cadastro e entrada compartilham o limite, para não servirem de atalho um para o outro.
  const attemptLimiter = rateLimit({
    windowMs: LOGIN_WINDOW_MS,
    limit: LOGIN_ATTEMPTS_PER_WINDOW,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' },
    ...loginLimit,
  });

  router.post(
    '/cadastro',
    attemptLimiter,
    asyncHandler(async (req, res) => {
      if (!registrationOpen) {
        res.status(403).json({ error: 'O cadastro de novas contas está fechado.' });
        return;
      }

      const body = parseBody(registerSchema, req.body);
      const { user, token } = await auth.register({ ...body, termosVersao: TERMS_VERSION });
      res.cookie(SESSION_COOKIE, token, cookieOptions(secureCookies));
      res.status(201).json({ user });
    }),
  );

  router.post(
    '/entrar',
    attemptLimiter,
    asyncHandler(async (req, res) => {
      const session = await auth.login(parseBody(loginSchema, req.body));
      if (!session) {
        res.status(401).json({ error: 'E-mail ou senha inválidos.' });
        return;
      }

      res.cookie(SESSION_COOKIE, session.token, cookieOptions(secureCookies));
      res.json({ user: session.user });
    }),
  );

  router.post('/sair', (req, res) => {
    const token = readSessionToken(req);
    if (token) auth.logout(token);
    res.clearCookie(SESSION_COOKIE, cookieOptions(secureCookies));
    res.status(204).end();
  });

  // Todos os campos são opcionais: o painel envia só o que mudou.
  router.patch(
    '/conta',
    requireAuth(auth),
    asyncHandler(async (req, res) => {
      const body = parseBody(accountSchema, req.body);
      const user = await auth.updateAccount(req.user.id, body);
      res.json({ user });
    }),
  );

  // Exclusão de conta (LGPD): apaga a conta e todos os dados dela, com confirmação da senha.
  router.delete(
    '/conta',
    requireAuth(auth),
    asyncHandler(async (req, res) => {
      const body = parseBody(deleteAccountSchema, req.body);
      await auth.deleteAccount(req.user.id, body.senhaAtual);
      res.clearCookie(SESSION_COOKIE, cookieOptions(secureCookies));
      res.status(204).end();
    }),
  );

  router.get('/sessao', requireAuth(auth), (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}
