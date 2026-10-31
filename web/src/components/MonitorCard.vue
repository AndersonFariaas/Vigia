<script setup>
import { computed, ref } from 'vue';
import { api, messageOf } from '../api.js';
import { formatDate } from '../format.js';
import AlertHistory from './AlertHistory.vue';

const STATUS_VIEW = {
  referencia: { label: 'referência salva', tone: 'info' },
  ok: { label: 'sem mudanças', tone: 'ok' },
  alterado: { label: 'alterado', tone: 'alert' },
  erro: { label: 'erro', tone: 'error' },
};
const PENDING_STATUS_VIEW = { label: 'aguardando 1ª checagem', tone: 'neutral' };

const CHECK_NOTES = {
  referencia: 'Referência salva. As próximas checagens vão comparar com esta versão.',
  ok: 'Nenhuma mudança desde a última checagem.',
  alterado: 'Mudança detectada. O alerta foi registrado e será enviado por e-mail.',
};

const props = defineProps({
  monitor: { type: Object, required: true },
});
const emit = defineEmits(['updated', 'removed']);

const busy = ref(false);
// Resultado da última ação deste cartão: { tone: 'info' | 'error', text }.
const note = ref(null);
const historyOpen = ref(false);

const title = computed(() => props.monitor.label || props.monitor.url);
const statusView = computed(() => STATUS_VIEW[props.monitor.lastStatus] ?? PENDING_STATUS_VIEW);
const historyId = computed(() => `history-${props.monitor.id}`);

function noteForCheck(result) {
  if (result.status === 'erro') return { tone: 'error', text: result.message };
  if (result.status === 'em_andamento') {
    return { tone: 'info', text: 'Esta página já está sendo verificada.' };
  }
  return { tone: 'info', text: CHECK_NOTES[result.status] };
}

async function checkNow() {
  busy.value = true;
  note.value = null;
  try {
    const { result, monitor } = await api.checkMonitor(props.monitor.id);
    emit('updated', monitor);
    note.value = noteForCheck(result);
  } catch (error) {
    note.value = { tone: 'error', text: messageOf(error) };
  } finally {
    busy.value = false;
  }
}

async function remove() {
  // Confirmação explícita: a remoção apaga snapshots e alertas em cascata.
  if (!window.confirm(`Remover "${title.value}"? O histórico de checagens e alertas também será apagado.`)) {
    return;
  }

  busy.value = true;
  try {
    await api.deleteMonitor(props.monitor.id);
    emit('removed', props.monitor.id);
  } catch (error) {
    note.value = { tone: 'error', text: messageOf(error) };
    busy.value = false;
  }
}
</script>

<template>
  <li class="card">
    <div class="card__header">
      <div>
        <h3 class="card__title">{{ title }}</h3>
        <p v-if="monitor.label" class="card__meta">
          <a :href="monitor.url" target="_blank" rel="noopener noreferrer">{{ monitor.url }}</a>
        </p>
        <p class="card__meta">
          intervalo {{ monitor.intervalMinutes }} min · última checagem
          {{ formatDate(monitor.lastCheckedAt) }}
        </p>
      </div>
      <span class="badge" :class="`badge--${statusView.tone}`">{{ statusView.label }}</span>
    </div>

    <p v-if="monitor.lastError && note?.tone !== 'error'" class="card__error">{{ monitor.lastError }}</p>

    <p
      v-if="note"
      :class="note.tone === 'error' ? 'card__error' : 'card__note'"
      role="status"
      aria-live="polite"
    >
      {{ note.text }}
    </p>

    <div class="card__actions">
      <button
        class="button button--primary button--small"
        type="button"
        :disabled="busy"
        :aria-busy="busy"
        @click="checkNow"
      >
        <span v-if="busy" class="spinner" aria-hidden="true"></span>
        {{ busy ? 'Checando…' : 'Checar agora' }}
      </button>

      <button
        class="button button--ghost button--small"
        type="button"
        :aria-expanded="historyOpen"
        :aria-controls="historyId"
        @click="historyOpen = !historyOpen"
      >
        {{ historyOpen ? 'Ocultar alertas' : 'Ver alertas' }}
      </button>

      <button class="button button--danger button--small" type="button" :disabled="busy" @click="remove">
        Remover
      </button>
    </div>

    <Transition name="collapse">
      <div v-if="historyOpen" :id="historyId" class="history-collapse">
        <AlertHistory :monitor="monitor" />
      </div>
    </Transition>
  </li>
</template>
