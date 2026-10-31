<script setup>
import { onMounted, reactive, ref, watch } from 'vue';
import { api, messageOf } from '../api.js';
import { formatDate } from '../format.js';

const SEND_STATUS_LABEL = {
  pendente: 'aguardando envio',
  enviado: 'e-mail enviado',
  falhou: 'falha no envio',
};

const SEVERITY_LABEL = {
  alta: 'risco alto',
  media: 'risco médio',
  baixa: 'risco baixo',
};

const props = defineProps({
  monitor: { type: Object, required: true },
});

const alerts = ref([]);
const loading = ref(true);
const loadError = ref('');
// Análise da Devin por alerta: ocupado e erro ficam separados da lista.
const analyzing = reactive({});
const analysisErrors = reactive({});

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    alerts.value = await api.listAlerts(props.monitor.id);
  } catch (error) {
    loadError.value = messageOf(error);
  } finally {
    loading.value = false;
  }
}

// Uma checagem nova pode ter gerado alertas, então a lista acompanha a última checagem.
watch(() => props.monitor.lastCheckedAt, load);
onMounted(load);

async function analyze(alert) {
  analyzing[alert.id] = true;
  delete analysisErrors[alert.id];
  try {
    const analysis = await api.analyzeAlert(props.monitor.id, alert.id);
    alert.analysis = { sessionUrl: analysis.sessionUrl, createdAt: analysis.createdAt };
  } catch (error) {
    analysisErrors[alert.id] = messageOf(error);
  } finally {
    delete analyzing[alert.id];
  }
}
</script>

<template>
  <div class="history">
    <p class="history__title">Alertas</p>
    <p class="card__note">
      A análise abre uma sessão na Devin e consome créditos da conta. Cada alerta é analisado uma vez.
    </p>

    <p v-if="loading" class="card__note">Carregando…</p>
    <p v-else-if="loadError" class="card__error">{{ loadError }}</p>
    <p v-else-if="!alerts.length" class="card__note">Nenhum alerta ainda.</p>

    <ul v-else class="history__list">
      <li v-for="alert in alerts" :key="alert.id" class="history__item">
        <p>
          <span class="history__time">{{ formatDate(alert.createdAt) }}</span>
          · {{ SEND_STATUS_LABEL[alert.sendStatus] ?? alert.sendStatus }}
        </p>

        <template v-if="alert.kind === 'risco'">
          <p>{{ alert.details.titulo }}</p>
          <p class="card__meta">
            {{ SEVERITY_LABEL[alert.severity] ?? alert.severity }} · {{ alert.details.descricao }}
          </p>
        </template>
        <template v-else>
          <p class="card__meta">+{{ alert.details.addedCount }} / −{{ alert.details.removedCount }} linhas</p>

          <ul v-if="alert.details.added.length" class="diff">
            <li v-for="(line, index) in alert.details.added" :key="`a-${index}`" class="diff__added">
              + {{ line }}
            </li>
          </ul>
          <ul v-if="alert.details.removed.length" class="diff">
            <li v-for="(line, index) in alert.details.removed" :key="`r-${index}`" class="diff__removed">
              − {{ line }}
            </li>
          </ul>
        </template>

        <div class="card__actions">
          <a
            v-if="alert.analysis"
            class="button button--ghost button--small"
            :href="alert.analysis.sessionUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            Ver análise na Devin
          </a>
          <button
            v-else
            class="button button--ghost button--small"
            type="button"
            :disabled="Boolean(analyzing[alert.id])"
            :aria-busy="Boolean(analyzing[alert.id])"
            @click="analyze(alert)"
          >
            <span v-if="analyzing[alert.id]" class="spinner" aria-hidden="true"></span>
            {{ analyzing[alert.id] ? 'Analisando…' : 'Analisar com Devin' }}
          </button>
        </div>
        <p v-if="analysisErrors[alert.id]" class="card__error" role="alert">
          {{ analysisErrors[alert.id] }}
        </p>
      </li>
    </ul>
  </div>
</template>
