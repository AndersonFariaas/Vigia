<script setup>
import { onMounted, reactive, ref } from 'vue';
import { api, ApiError } from './api.js';

const FREQUENCY_OPTIONS = [
  { value: 15, label: 'A cada 15 minutos' },
  { value: 30, label: 'A cada 30 minutos' },
  { value: 60, label: 'A cada 1 hora' },
  { value: 360, label: 'A cada 6 horas' },
  { value: 720, label: 'A cada 12 horas' },
  { value: 1440, label: 'Uma vez por dia' },
];
const DEFAULT_INTERVAL_MINUTES = 60;
const THEME_STORAGE_KEY = 'vigia-theme';
const THEME_TRANSITION_MS = 300;

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

const theme = ref('light');
const apiOnline = ref(null);

const monitors = ref([]);
const listState = ref('loading');
const listError = ref('');

const form = reactive({ url: '', label: '', intervalMinutes: DEFAULT_INTERVAL_MINUTES });
const formError = ref('');
const submitting = ref(false);

// Estados por monitor, indexados pelo id: ocupado, última nota e histórico aberto.
const busy = reactive({});
const notes = reactive({});
const history = reactive({});
// Análise da Devin, por alerta: ocupado e erro ficam separados da lista de alertas.
const analyzing = reactive({});
const analysisErrors = reactive({});

function messageOf(error) {
  // A API devolve detalhes de validação já legíveis; priorizamos eles.
  if (error instanceof ApiError && error.details.length) return error.details.join(' ');
  return error.message;
}

function formatDate(iso) {
  if (!iso) return 'nunca';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function statusOf(monitor) {
  return STATUS_VIEW[monitor.lastStatus] ?? PENDING_STATUS_VIEW;
}

function replaceMonitor(updated) {
  const index = monitors.value.findIndex((item) => item.id === updated.id);
  if (index !== -1) monitors.value[index] = updated;
}

function noteForCheck(result) {
  if (result.status === 'erro') return { tone: 'error', text: result.message };
  if (result.status === 'em_andamento') {
    return { tone: 'info', text: 'Esta página já está sendo verificada.' };
  }
  return { tone: 'info', text: CHECK_NOTES[result.status] };
}

function applyTheme(value) {
  theme.value = value;
  document.documentElement.dataset.theme = value;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch {
    // Modo privado ou armazenamento bloqueado: o tema vale só nesta sessão.
  }
}

function toggleTheme() {
  // A classe liga a transição de cor só durante a troca. Assim, a página não anima ao carregar.
  document.documentElement.classList.add('theme-switching');
  applyTheme(theme.value === 'dark' ? 'light' : 'dark');
  window.setTimeout(() => {
    document.documentElement.classList.remove('theme-switching');
  }, THEME_TRANSITION_MS);
}

function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    saved = null;
  }
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved ?? (prefersDark ? 'dark' : 'light'));
}

async function checkHealth() {
  try {
    await api.health();
    apiOnline.value = true;
  } catch {
    apiOnline.value = false;
  }
}

async function loadMonitors() {
  listState.value = 'loading';
  try {
    monitors.value = await api.listMonitors();
    listState.value = 'ready';
  } catch (error) {
    listError.value = messageOf(error);
    listState.value = 'error';
  }
}

async function addMonitor() {
  formError.value = '';
  submitting.value = true;
  try {
    const created = await api.createMonitor({
      url: form.url.trim(),
      label: form.label.trim() || undefined,
      intervalMinutes: Number(form.intervalMinutes),
    });
    monitors.value.unshift(created);
    form.url = '';
    form.label = '';
    form.intervalMinutes = DEFAULT_INTERVAL_MINUTES;
  } catch (error) {
    formError.value = messageOf(error);
  } finally {
    submitting.value = false;
  }
}

async function checkNow(monitor) {
  busy[monitor.id] = true;
  delete notes[monitor.id];
  try {
    const { result, monitor: updated } = await api.checkMonitor(monitor.id);
    replaceMonitor(updated);
    notes[monitor.id] = noteForCheck(result);
    if (history[monitor.id]?.open) await loadHistory(monitor.id);
  } catch (error) {
    notes[monitor.id] = { tone: 'error', text: messageOf(error) };
  } finally {
    delete busy[monitor.id];
  }
}

async function loadHistory(id) {
  const entry = history[id];
  entry.loading = true;
  entry.error = '';
  try {
    entry.items = await api.listAlerts(id);
  } catch (error) {
    entry.error = messageOf(error);
  } finally {
    entry.loading = false;
  }
}

function isHistoryOpen(monitor) {
  return Boolean(history[monitor.id]?.open);
}

async function toggleHistory(monitor) {
  if (isHistoryOpen(monitor)) {
    history[monitor.id].open = false;
    return;
  }
  history[monitor.id] = { open: true, loading: true, error: '', items: [] };
  await loadHistory(monitor.id);
}

async function analyzeAlert(monitor, alert) {
  analyzing[alert.id] = true;
  delete analysisErrors[alert.id];
  try {
    const analysis = await api.analyzeAlert(monitor.id, alert.id);
    alert.analysis = { sessionUrl: analysis.sessionUrl, createdAt: analysis.createdAt };
  } catch (error) {
    analysisErrors[alert.id] = messageOf(error);
  } finally {
    delete analyzing[alert.id];
  }
}

async function removeMonitor(monitor) {
  const name = monitor.label || monitor.url;
  // Confirmação explícita: a remoção apaga snapshots e alertas em cascata.
  if (!window.confirm(`Remover "${name}"? O histórico de checagens e alertas também será apagado.`)) {
    return;
  }

  busy[monitor.id] = true;
  try {
    await api.deleteMonitor(monitor.id);
    monitors.value = monitors.value.filter((item) => item.id !== monitor.id);
  } catch (error) {
    notes[monitor.id] = { tone: 'error', text: messageOf(error) };
  } finally {
    delete busy[monitor.id];
  }
}

onMounted(() => {
  initTheme();
  checkHealth();
  loadMonitors();
});
</script>

<template>
  <div class="app">
    <header class="topbar">
      <h1 class="brand">
        <span class="brand__prompt" aria-hidden="true">$</span>vigia
        <span class="brand__hint">Monitor de páginas com alerta por e-mail</span>
      </h1>

      <div class="topbar__controls">
        <p
          class="status"
          role="status"
          :class="{ 'status--online': apiOnline === true, 'status--offline': apiOnline === false }"
        >
          <span class="status__dot" aria-hidden="true"></span>
          {{ apiOnline === null ? 'verificando API…' : apiOnline ? 'API online' : 'API offline' }}
        </p>
        <button class="button button--ghost button--small" type="button" @click="toggleTheme">
          {{ theme === 'dark' ? 'Modo claro' : 'Modo escuro' }}
        </button>
      </div>
    </header>

    <section class="panel" aria-labelledby="new-monitor-title">
      <p class="eyebrow">$ vigia add</p>
      <h2 id="new-monitor-title" class="panel__title">Monitorar uma página</h2>

      <form class="form" @submit.prevent="addMonitor">
        <div class="field form__url">
          <label class="field__label" for="monitor-url">Endereço da página</label>
          <input
            id="monitor-url"
            v-model="form.url"
            class="input"
            type="url"
            required
            inputmode="url"
            autocomplete="off"
            spellcheck="false"
            placeholder="https://exemplo.com/precos"
            aria-describedby="monitor-url-hint"
            :disabled="submitting"
          />
          <span id="monitor-url-hint" class="field__hint">
            Somente http ou https, nas portas 80 e 443. Endereços internos são bloqueados.
          </span>
        </div>

        <div class="field">
          <label class="field__label" for="monitor-label">Nome (opcional)</label>
          <input
            id="monitor-label"
            v-model="form.label"
            class="input"
            type="text"
            maxlength="80"
            placeholder="Preço do produto X"
            :disabled="submitting"
          />
        </div>

        <div class="field">
          <label class="field__label" for="monitor-interval">Frequência</label>
          <select
            id="monitor-interval"
            v-model.number="form.intervalMinutes"
            class="select"
            :disabled="submitting"
          >
            <option v-for="option in FREQUENCY_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>

        <div class="form__actions">
          <button class="button button--primary" type="submit" :disabled="submitting">
            <span v-if="submitting" class="spinner" aria-hidden="true"></span>
            {{ submitting ? 'Salvando…' : 'Monitorar página' }}
          </button>
        </div>
      </form>

      <p v-if="formError" class="message message--error" role="alert">{{ formError }}</p>
    </section>

    <section aria-labelledby="monitors-title">
      <h2 id="monitors-title" class="panel__title section-title">Páginas monitoradas</h2>

      <p v-if="listState === 'loading'" class="message" role="status">Carregando…</p>

      <div v-else-if="listState === 'error'" class="message message--error" role="alert">
        {{ listError }}
        <button class="button button--ghost button--small" type="button" @click="loadMonitors">
          Tentar de novo
        </button>
      </div>

      <div v-else-if="!monitors.length" class="empty">
        Nenhuma página monitorada ainda. Cadastre a primeira acima.
      </div>

      <TransitionGroup v-else name="card" tag="ul" class="list">
        <li v-for="monitor in monitors" :key="monitor.id" class="card">
          <div class="card__header">
            <div>
              <h3 class="card__title">{{ monitor.label || monitor.url }}</h3>
              <p v-if="monitor.label" class="card__meta">
                <a :href="monitor.url" target="_blank" rel="noopener noreferrer">{{ monitor.url }}</a>
              </p>
              <p class="card__meta">
                intervalo {{ monitor.intervalMinutes }} min · última checagem
                {{ formatDate(monitor.lastCheckedAt) }}
              </p>
            </div>
            <span class="badge" :class="`badge--${statusOf(monitor).tone}`">
              {{ statusOf(monitor).label }}
            </span>
          </div>

          <p v-if="monitor.lastError && notes[monitor.id]?.tone !== 'error'" class="card__error">
            {{ monitor.lastError }}
          </p>

          <p
            v-if="notes[monitor.id]"
            :class="notes[monitor.id].tone === 'error' ? 'card__error' : 'card__note'"
            role="status"
            aria-live="polite"
          >
            {{ notes[monitor.id].text }}
          </p>

          <div class="card__actions">
            <button
              class="button button--primary button--small"
              type="button"
              :disabled="Boolean(busy[monitor.id])"
              :aria-busy="Boolean(busy[monitor.id])"
              @click="checkNow(monitor)"
            >
              <span v-if="busy[monitor.id]" class="spinner" aria-hidden="true"></span>
              {{ busy[monitor.id] ? 'Checando…' : 'Checar agora' }}
            </button>

            <button
              class="button button--ghost button--small"
              type="button"
              :aria-expanded="isHistoryOpen(monitor)"
              @click="toggleHistory(monitor)"
            >
              {{ isHistoryOpen(monitor) ? 'Ocultar alertas' : 'Ver alertas' }}
            </button>

            <button
              class="button button--danger button--small"
              type="button"
              :disabled="Boolean(busy[monitor.id])"
              @click="removeMonitor(monitor)"
            >
              Remover
            </button>
          </div>

          <Transition name="collapse">
            <div v-if="isHistoryOpen(monitor)" class="history-collapse">
              <div class="history">
                <p class="history__title">Alertas</p>
                <p class="card__note">
                  A análise abre uma sessão na Devin e consome créditos da conta. Cada alerta é analisado uma vez.
                </p>

                <p v-if="history[monitor.id].loading" class="card__note">Carregando…</p>
                <p v-else-if="history[monitor.id].error" class="card__error">
                  {{ history[monitor.id].error }}
                </p>
                <p v-else-if="!history[monitor.id].items.length" class="card__note">
                  Nenhum alerta ainda.
                </p>

                <ul v-else class="history__list">
                  <li v-for="alert in history[monitor.id].items" :key="alert.id" class="history__item">
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
                      <p class="card__meta">
                        +{{ alert.details.addedCount }} / −{{ alert.details.removedCount }} linhas
                      </p>

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
                        @click="analyzeAlert(monitor, alert)"
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
            </div>
          </Transition>
        </li>
      </TransitionGroup>
    </section>

    <p class="card__note" style="margin-top: 32px">
      Fase 1: sem login. Mantenha o servidor em 127.0.0.1 e não exponha esta página na internet.
    </p>
  </div>
</template>
