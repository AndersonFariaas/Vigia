const DEFAULT_BATCH_SIZE = 20;

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * A página monitorada não é confiável: qualquer texto dela (e até o nome do
 * monitor) pode conter HTML ou script. Por isso TODO valor passa por aqui.
 */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

function lineList(lines) {
  if (!lines.length) return '<p style="margin:0;color:#64748b">Nenhuma linha.</p>';
  const items = lines.map((line) => `<li style="margin:0 0 6px">${escapeHtml(line)}</li>`);
  return `<ul style="margin:0;padding-left:20px;font-family:Consolas,monospace;font-size:13px">${items.join('')}</ul>`;
}

function describe(alert) {
  const { details } = alert;
  return `${details.addedCount} linha(s) adicionada(s), ${details.removedCount} removida(s)`;
}

const SEVERITY_LABELS = { alta: 'risco alto', media: 'risco médio', baixa: 'risco baixo' };

/** E-mail de um sinal de risco (formulário de senha, domínio parecido, certificado...). */
function renderRiskEmail(alert) {
  const label = alert.monitor_label || alert.monitor_url;
  const { details } = alert;
  const severity = SEVERITY_LABELS[alert.severity] ?? 'risco';
  const subject = `Vigia: ${severity} em ${label}`.replace(/[\r\n]+/g, ' ');

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f8fafc;color:#0f172a;font-family:Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:24px">
      <p style="margin:0 0 8px;color:#b91c1c;font-weight:bold">Vigia · ${escapeHtml(severity)}</p>
      <h1 style="margin:0 0 12px;font-size:20px">${escapeHtml(details.titulo)}</h1>
      <p style="margin:0 0 16px"><a href="${escapeHtml(alert.monitor_url)}" style="color:#2563eb">${escapeHtml(alert.monitor_url)}</a></p>
      <p style="margin:0 0 16px">${escapeHtml(details.descricao)}</p>
      <p style="margin:0;color:#64748b;font-size:13px">Verifique o site diretamente antes de digitar dados pessoais ou senhas.</p>
    </div>
  </body>
</html>`;

  const text = [
    `${details.titulo} (${severity})`,
    alert.monitor_url,
    '',
    details.descricao,
    '',
    'Verifique o site diretamente antes de digitar dados pessoais ou senhas.',
  ].join('\n');

  return { subject, html, text };
}

/** Monta o e-mail de um alerta. Função pura: fácil de testar e de revisar. */
export function renderAlertEmail(alert) {
  if (alert.kind === 'risco') return renderRiskEmail(alert);

  const label = alert.monitor_label || alert.monitor_url;
  const { details } = alert;
  const subject = `Vigia: alteração em ${label}`.replace(/[\r\n]+/g, ' ');

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f8fafc;color:#0f172a;font-family:Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:24px">
      <p style="margin:0 0 8px;color:#059669;font-weight:bold">Vigia · alteração detectada</p>
      <h1 style="margin:0 0 12px;font-size:20px">${escapeHtml(label)}</h1>
      <p style="margin:0 0 16px"><a href="${escapeHtml(alert.monitor_url)}" style="color:#2563eb">${escapeHtml(alert.monitor_url)}</a></p>
      <p style="margin:0 0 16px">${escapeHtml(describe(alert))}.</p>
      <h2 style="font-size:14px;margin:16px 0 8px">Adicionado</h2>
      ${lineList(details.added)}
      <h2 style="font-size:14px;margin:16px 0 8px">Removido</h2>
      ${lineList(details.removed)}
    </div>
  </body>
</html>`;

  const text = [
    `Alteração detectada em ${label}`,
    alert.monitor_url,
    describe(alert),
    '',
    'Adicionado:',
    ...details.added.map((line) => `+ ${line}`),
    '',
    'Removido:',
    ...details.removed.map((line) => `- ${line}`),
  ].join('\n');

  return { subject, html, text };
}

/**
 * Envia os alertas pendentes em lote. Falha em um item é registrada e não
 * interrompe os demais. Alertas com falha não são reenviados automaticamente.
 */
export function createDispatcher({
  alerts,
  sendEmail,
  now = () => new Date(),
  batchSize = DEFAULT_BATCH_SIZE,
  log = () => {},
}) {
  return async function dispatchPending() {
    const pending = alerts.findPendingWithMonitor(batchSize);
    let sent = 0;
    let failed = 0;

    for (const alert of pending) {
      try {
        await sendEmail(renderAlertEmail(alert));
        alerts.markSent(alert.id, now().toISOString());
        sent += 1;
      } catch (error) {
        alerts.markFailed(alert.id);
        failed += 1;
        log('error', `Falha ao enviar o alerta ${alert.id}: ${error.code ?? error.name}`);
      }
    }

    return { sent, failed };
  };
}
