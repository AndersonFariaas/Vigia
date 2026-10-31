import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from '../../security/passwords.js';
import { createSessionToken, hashSessionToken, SESSION_DAYS } from '../../security/sessionToken.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export class AccountUpdateError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AccountUpdateError';
    this.status = status;
    this.expose = true;
  }
}

export class AccountExistsError extends Error {
  constructor() {
    // Mensagem genérica de propósito: não confirma se o e-mail já tem conta.
    super('Não foi possível criar a conta com estes dados.');
    this.name = 'AccountExistsError';
    this.status = 409;
    this.expose = true;
  }
}

/**
 * Cadastro, entrada, saída e leitura de sessão. Todas as dependências entram por parâmetro.
 * Devolve `null` em vez de lançar quando a credencial não bate: quem chama decide a resposta.
 */
export function createAuthService({ users, sessions, now = () => new Date() }) {
  let dummyHash = null;

  // Usada quando o e-mail não existe. Assim, a resposta leva o mesmo tempo de uma conta real.
  async function getDummyHash() {
    dummyHash ??= await hashPassword(randomBytes(16).toString('hex'));
    return dummyHash;
  }

  function startSession(userId) {
    const token = createSessionToken();
    const expiresAt = new Date(now().getTime() + SESSION_DAYS * DAY_MS).toISOString();
    sessions.create({ tokenHash: hashSessionToken(token), userId, expiresAt });
    return token;
  }

  return {
    async register({ nome, email, password }) {
      const passwordHash = await hashPassword(password);
      let userId;
      try {
        userId = users.create({ email, passwordHash, nome });
      } catch (error) {
        if (error.message?.includes('UNIQUE constraint failed')) throw new AccountExistsError();
        throw error;
      }
      return { user: { id: userId, email, nome }, token: startSession(userId) };
    },

    async login({ email, password }) {
      const user = users.findByEmail(email);
      const ok = await verifyPassword(password, user?.password_hash ?? (await getDummyHash()));
      // Conta sem senha (vinda da Fase 1) não entra até alguém definir uma pelo comando "npm run usuario".
      if (!user?.password_hash || !ok) return null;

      return { user: { id: user.id, email: user.email, nome: user.nome }, token: startSession(user.id) };
    },

    // Abre uma sessão para um usuário já existente. Os testes usam para montar o cookie sem login.
    openSession(userId) {
      return startSession(userId);
    },

    /**
     * Altera nome, e-mail e senha. Trocar e-mail ou senha exige a senha atual.
     * Lança erro com mensagem própria quando a regra não é cumprida.
     */
    async updateAccount(userId, { nome, email, senhaAtual, novaSenha }) {
      const current = users.findAuthById(userId);
      const emailChanged = email !== undefined && email !== current.email;
      const passwordChanged = novaSenha !== undefined;

      if (emailChanged || passwordChanged) {
        if (senhaAtual === undefined) throw new AccountUpdateError(400, 'Informe a senha atual para trocar e-mail ou senha.');
        if (!(await verifyPassword(senhaAtual, current.password_hash))) {
          throw new AccountUpdateError(400, 'Senha atual incorreta.');
        }
      }

      if (emailChanged && users.findByEmail(email)) {
        throw new AccountUpdateError(409, 'Este e-mail já está em uso.');
      }

      const next = {
        id: userId,
        nome: nome ?? current.nome,
        email: emailChanged ? email : current.email,
        passwordHash: passwordChanged ? await hashPassword(novaSenha) : current.password_hash,
      };
      try {
        users.update(next);
      } catch (error) {
        if (error.message?.includes('UNIQUE constraint failed')) {
          throw new AccountUpdateError(409, 'Este e-mail já está em uso.');
        }
        throw error;
      }
      return { id: next.id, email: next.email, nome: next.nome };
    },

    logout(token) {
      sessions.delete(hashSessionToken(token));
    },

    userForToken(token) {
      return sessions.findActiveUser(hashSessionToken(token), now().toISOString()) ?? null;
    },
  };
}
