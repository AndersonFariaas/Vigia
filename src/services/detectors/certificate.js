import tls from 'node:tls';

const TLS_PORT = 443;
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Lê a data de validade do certificado do host. Retorna ISO ou null.
 *
 * `rejectUnauthorized: false` é intencional: um certificado já vencido ainda precisa
 * ser lido para o alerta. Nenhum dado do usuário é enviado nesta conexão, só o handshake.
 * Falhas (rede, timeout, resposta inválida) viram null, sem derrubar a checagem.
 */
export function readCertificateExpiry(hostname, { timeoutMs = DEFAULT_TIMEOUT_MS, connect = tls.connect } = {}) {
  return new Promise((resolve) => {
    const socket = connect({
      host: hostname,
      port: TLS_PORT,
      servername: hostname,
      rejectUnauthorized: false,
      timeout: timeoutMs,
    });

    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };

    socket.once('secureConnect', () => {
      const certificate = socket.getPeerCertificate();
      const validTo = new Date(certificate?.valid_to ?? '');
      finish(Number.isNaN(validTo.getTime()) ? null : validTo.toISOString());
    });
    socket.once('timeout', () => finish(null));
    socket.once('error', () => finish(null));
  });
}
