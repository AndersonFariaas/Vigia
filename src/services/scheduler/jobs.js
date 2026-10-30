import nodeCron from 'node-cron';

const DEFAULT_BATCH_SIZE = 20;

/**
 * Uma rodada: checa até `batchSize` monitores vencidos, em sequência, e depois
 * envia os alertas pendentes. Se a rodada anterior ainda está rodando, esta é ignorada.
 * Exceções são registradas e nunca derrubam o agendador.
 */
export function createRoundRunner({
  findDue,
  checkMonitor,
  dispatchPending,
  batchSize = DEFAULT_BATCH_SIZE,
  log = () => {},
}) {
  let running = false;

  return async function runRound() {
    if (running) {
      log('warn', 'Rodada anterior ainda em execução; esta foi ignorada.');
      return { skipped: true };
    }

    running = true;
    try {
      const due = findDue(batchSize);
      let checked = 0;

      for (const monitor of due) {
        try {
          await checkMonitor(monitor);
          checked += 1;
        } catch (error) {
          log('error', `Erro ao checar o monitor ${monitor.id}: ${error.name}`);
        }
      }

      const { sent, failed } = await dispatchPending();
      return { skipped: false, checked, sent, failed };
    } catch (error) {
      log('error', `Rodada falhou: ${error.name}`);
      return { skipped: false, error: error.name };
    } finally {
      running = false;
    }
  };
}

export function startScheduler({ expression, runRound, cron = nodeCron, log = () => {} }) {
  const task = cron.schedule(expression, () => {
    runRound().catch((error) => log('error', `Agendador: ${error.name}`));
  });

  return {
    stop() {
      task.stop();
    },
  };
}
