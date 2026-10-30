<script setup>
import { reactive, ref } from 'vue';
import { api, ApiError } from '../api.js';

const MIN_PASSWORD_LENGTH = 10;

defineProps({
  aviso: { type: String, default: '' },
});
const emit = defineEmits(['autenticado']);

const mode = ref('entrar');
const form = reactive({ email: '', password: '' });
const errorMessage = ref('');
const submitting = ref(false);

function messageOf(error) {
  // A API devolve detalhes de validação já legíveis; priorizamos eles.
  if (error instanceof ApiError && error.details.length) return error.details.join(' ');
  return error.message;
}

function switchMode(next) {
  mode.value = next;
  errorMessage.value = '';
}

async function submit() {
  errorMessage.value = '';
  submitting.value = true;
  const payload = { email: form.email.trim(), password: form.password };
  try {
    const { user } = mode.value === 'cadastro' ? await api.register(payload) : await api.login(payload);
    form.password = '';
    emit('autenticado', user);
  } catch (error) {
    errorMessage.value = messageOf(error);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="panel auth" aria-labelledby="auth-title">
    <p class="eyebrow">$ vigia login</p>
    <h2 id="auth-title" class="panel__title">
      {{ mode === 'cadastro' ? 'Criar conta' : 'Entrar na sua conta' }}
    </h2>

    <p v-if="aviso" class="message message--info" role="status">{{ aviso }}</p>

    <div class="segmented" role="group" aria-label="Escolha entre entrar e criar conta">
      <button
        class="button button--ghost button--small"
        type="button"
        :aria-pressed="mode === 'entrar'"
        @click="switchMode('entrar')"
      >
        Entrar
      </button>
      <button
        class="button button--ghost button--small"
        type="button"
        :aria-pressed="mode === 'cadastro'"
        @click="switchMode('cadastro')"
      >
        Criar conta
      </button>
    </div>

    <form class="form" @submit.prevent="submit">
      <div class="field">
        <label class="field__label" for="auth-email">E-mail</label>
        <input
          id="auth-email"
          v-model="form.email"
          class="input"
          type="email"
          required
          autocomplete="email"
          spellcheck="false"
          :disabled="submitting"
        />
        <span class="field__hint">Os alertas das suas páginas são enviados para este e-mail.</span>
      </div>

      <div class="field">
        <label class="field__label" for="auth-password">Senha</label>
        <input
          id="auth-password"
          v-model="form.password"
          class="input"
          type="password"
          required
          :minlength="mode === 'cadastro' ? MIN_PASSWORD_LENGTH : undefined"
          :autocomplete="mode === 'cadastro' ? 'new-password' : 'current-password'"
          :disabled="submitting"
        />
        <span v-if="mode === 'cadastro'" class="field__hint">
          Mínimo de {{ MIN_PASSWORD_LENGTH }} caracteres.
        </span>
      </div>

      <div class="form__actions">
        <button class="button button--primary" type="submit" :disabled="submitting">
          <span v-if="submitting" class="spinner" aria-hidden="true"></span>
          {{ submitting ? 'Aguarde…' : mode === 'cadastro' ? 'Criar conta' : 'Entrar' }}
        </button>
      </div>
    </form>

    <p v-if="errorMessage" class="message message--error" role="alert">{{ errorMessage }}</p>
  </section>
</template>

<style scoped>
.segmented {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.segmented .button[aria-pressed='true'] {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
