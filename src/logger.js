/**
 * Logs estruturados: uma linha JSON por evento, com horário, nível e mensagem.
 * Assim dá para filtrar por campo em qualquer ferramenta de log.
 * Nunca passe segredos, cookies, corpo de requisição ou mensagem crua de erro: só nomes e códigos.
 */
export function createLogger({
  out = process.stdout,
  err = process.stderr,
  now = () => new Date(),
} = {}) {
  return function log(level, message, fields = {}) {
    const entry = { time: now().toISOString(), level, msg: message, ...fields };
    const stream = level === 'error' ? err : out;
    stream.write(`${JSON.stringify(entry)}\n`);
  };
}
