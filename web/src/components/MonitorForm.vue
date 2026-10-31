<script setup>
import { reactive, ref } from 'vue';
import { api, messageOf } from '../api.js';

const FREQUENCY_OPTIONS = [
  { value: 15, label: 'A cada 15 minutos' },
  { value: 30, label: 'A cada 30 minutos' },
  { value: 60, label: 'A cada 1 hora' },
  { value: 360, label: 'A cada 6 horas' },
  { value: 720, label: 'A cada 12 horas' },
  { value: 1440, label: 'Uma vez por dia' },
];
const DEFAULT_INTERVAL_MINUTES = 60;

const emit = defineEmits(['created']);

function emptyForm() {
  return { url: '', label: '', intervalMinutes: DEFAULT_INTERVAL_MINUTES };
}

const form = reactive(emptyForm());
const error = ref('');
const submitting = ref(false);

async function submit() {
  error.value = '';
  submitting.value = true;
  try {
    const created = await api.createMonitor({
      url: form.url.trim(),
      label: form.label.trim() || undefined,
      intervalMinutes: Number(form.intervalMinutes),
    });
    emit('created', created);
    Object.assign(form, emptyForm());
  } catch (requestError) {
    error.value = messageOf(requestError);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="panel" aria-labelledby="new-monitor-title">
    <p class="eyebrow">$ vigia add</p>
    <h2 id="new-monitor-title" class="panel__title">Monitorar uma página</h2>

    <form class="form" @submit.prevent="submit">
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

      <div class="form__row">
        <div class="field form__name">
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

        <div class="field form__interval">
          <label class="field__label" for="monitor-interval">Frequência</label>
          <select id="monitor-interval" v-model.number="form.intervalMinutes" class="select" :disabled="submitting">
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
      </div>
    </form>

    <p v-if="error" class="message message--error" role="alert">{{ error }}</p>
  </section>
</template>
