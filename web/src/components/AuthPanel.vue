<script setup>
import { computed, reactive, ref } from 'vue';
import { api, ApiError } from '../api.js';

const MIN_NAME_LENGTH = 2;
const MIN_PASSWORD_LENGTH = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const props = defineProps({
  mode: { type: String, default: 'entrar' },
  aviso: { type: String, default: '' },
});
const emit = defineEmits(['update:mode', 'autenticado']);

const isSignUp = computed(() => props.mode === 'cadastro');

const form = reactive({ nome: '', email: '', password: '', confirmation: '' });
const errors = reactive({ nome: '', email: '', password: '', confirmation: '', general: '' });
const showPassword = ref(false);
const submitting = ref(false);

function clearErrors() {
  for (const key of Object.keys(errors)) errors[key] = '';
}

function switchTo(next) {
  emit('update:mode', next);
  form.confirmation = '';
  clearErrors();
}

function validate() {
  clearErrors();
  if (isSignUp.value && form.nome.trim().length < MIN_NAME_LENGTH) {
    errors.nome = `Informe seu nome (mínimo de ${MIN_NAME_LENGTH} caracteres).`;
  }
  if (!EMAIL_PATTERN.test(form.email.trim())) {
    errors.email = 'Informe um e-mail válido.';
  }
  if (isSignUp.value && form.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  } else if (!form.password) {
    errors.password = 'Informe a senha.';
  }
  if (isSignUp.value && form.confirmation !== form.password) {
    errors.confirmation = 'As senhas não coincidem.';
  }
  return !Object.values(errors).some(Boolean);
}

function messageOf(error) {
  // A API devolve detalhes de validação já legíveis; priorizamos eles.
  if (error instanceof ApiError && error.details.length) return error.details.join(' ');
  return error.message;
}

async function submit() {
  if (!validate()) return;

  submitting.value = true;
  const payload = { email: form.email.trim(), password: form.password };
  try {
    const { user } = isSignUp.value
      ? await api.register({ ...payload, nome: form.nome.trim() })
      : await api.login(payload);
    form.password = '';
    form.confirmation = '';
    emit('autenticado', user);
  } catch (error) {
    errors.general = messageOf(error);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="auth-card" aria-labelledby="auth-title">
    <h3 id="auth-title" class="auth-card__title">
      {{ isSignUp ? 'Crie sua conta' : 'Acesse sua conta' }}
    </h3>
    <p class="auth-card__text">
      {{ isSignUp ? 'Preencha os dados para começar a monitorar.' : 'Entre para acompanhar suas páginas.' }}
    </p>

    <p v-if="aviso" class="message message--info" role="status">{{ aviso }}</p>

    <div class="auth-tabs" role="group" aria-label="Escolha entre entrar e criar conta">
      <button class="auth-tabs__tab" type="button" :aria-pressed="!isSignUp" @click="switchTo('entrar')">
        Entrar
      </button>
      <button class="auth-tabs__tab" type="button" :aria-pressed="isSignUp" @click="switchTo('cadastro')">
        Criar conta
      </button>
    </div>

    <form class="auth-form" novalidate @submit.prevent="submit">
      <div class="auth-form__pair" :class="{ 'auth-form__pair--single': !isSignUp }">
        <div v-if="isSignUp" class="field">
          <label class="field__label" for="auth-nome">Nome</label>
          <input
            id="auth-nome"
            v-model="form.nome"
            class="input"
            type="text"
            autocomplete="name"
            maxlength="80"
            :aria-invalid="Boolean(errors.nome)"
            aria-describedby="auth-nome-error"
            :disabled="submitting"
          />
          <span v-if="errors.nome" id="auth-nome-error" class="field__error">{{ errors.nome }}</span>
        </div>

        <div class="field">
          <label class="field__label" for="auth-email">E-mail</label>
          <input
            id="auth-email"
            v-model="form.email"
            class="input"
            type="email"
            autocomplete="email"
            spellcheck="false"
            :aria-invalid="Boolean(errors.email)"
            aria-describedby="auth-email-error"
            :disabled="submitting"
          />
          <span v-if="errors.email" id="auth-email-error" class="field__error">{{ errors.email }}</span>
        </div>
      </div>

      <div class="field">
        <label class="field__label" for="auth-password">Senha</label>
        <div class="input-group">
          <input
            id="auth-password"
            v-model="form.password"
            class="input"
            :type="showPassword ? 'text' : 'password'"
            :autocomplete="isSignUp ? 'new-password' : 'current-password'"
            :aria-invalid="Boolean(errors.password)"
            aria-describedby="auth-password-error"
            :disabled="submitting"
          />
          <button
            class="input-group__toggle"
            type="button"
            :aria-pressed="showPassword"
            @click="showPassword = !showPassword"
          >
            {{ showPassword ? 'Ocultar' : 'Mostrar' }}
          </button>
        </div>
        <span v-if="errors.password" id="auth-password-error" class="field__error">
          {{ errors.password }}
        </span>
      </div>

      <div v-if="isSignUp" class="field">
        <label class="field__label" for="auth-confirmation">Confirme a senha</label>
        <input
          id="auth-confirmation"
          v-model="form.confirmation"
          class="input"
          :type="showPassword ? 'text' : 'password'"
          autocomplete="new-password"
          :aria-invalid="Boolean(errors.confirmation)"
          aria-describedby="auth-confirmation-error"
          :disabled="submitting"
        />
        <span v-if="errors.confirmation" id="auth-confirmation-error" class="field__error">
          {{ errors.confirmation }}
        </span>
      </div>

      <p v-if="errors.general" class="message message--error" role="alert">{{ errors.general }}</p>

      <button class="button button--primary" type="submit" :disabled="submitting">
        <span v-if="submitting" class="spinner" aria-hidden="true"></span>
        {{ submitting ? 'Aguarde…' : isSignUp ? 'Criar conta' : 'Entrar' }}
      </button>
    </form>
  </section>
</template>
