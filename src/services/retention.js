import { RETENTION_DAYS } from '../legal/termos.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Retenção (LGPD): apaga o histórico de checagens e alertas mais antigo que o prazo.
 * Páginas monitoradas e contas não entram aqui: elas só saem quando o próprio usuário as remove.
 * Dependências entram por parâmetro, para o teste controlar o relógio.
 */
export function createRetention({
  snapshots,
  alerts,
  now = () => new Date(),
  days = RETENTION_DAYS,
  log = () => {},
}) {
  return function purgeExpiredData() {
    const cutoff = new Date(now().getTime() - days * DAY_MS).toISOString();
    const removedSnapshots = snapshots.deleteOlderThan(cutoff);
    const removedAlerts = alerts.deleteOlderThan(cutoff);
    if (removedSnapshots + removedAlerts > 0) {
      log('info', `Retenção: ${removedSnapshots} snapshot(s) e ${removedAlerts} alerta(s) removidos.`);
    }
    return { removedSnapshots, removedAlerts };
  };
}
