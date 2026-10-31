<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue';
import { api, ApiError } from '../api.js';

const MIN_NAME_LENGTH = 2;
const MIN_PASSWORD_LENGTH = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const props = defineProps({
  mode: { type: String, required: true },
});
const emit = defineEmits(['close', 'autenticado']);

const current = ref(props.mode);
const isSignUp = computed(() => current.value === 'cadastro');
const title = computed(() => (isSignUp.value ? 'Criar sua conta' : 'Entrar na sua conta'));
const submitLabel = computed(() => (isSignUp.value ? 'Criar conta' : 'Entrar'));

const dialog = ref(null);
const form = reactive({ nome: '', email: '', password: '', confirmation: '' });
const errors = reactive({ nome: '', email: '', password: '', confirmation: '', general: '' });
const showPassword = ref(false);
const submitting = ref(false);

let previousBodyOverflow = '';

function clearErrors() {
  for (const key of Object.keys(errors)) errors[key] = '';
}

function switchTo(mode) {
  current.value = mode;
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
    emit('autenticado', user);
  } catch (error) {
    errors.general = messageOf(error);
  } finally {
    submitting.value = false;
  }
}

// Tab não sai do modal: quem navega por teclado fica preso até fechar.
function keepFocusInside(event) {
  const focusable = [...dialog.value.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function onKeydown(event) {
  if (event.key === 'Escape' && !submitting.value) emit('close');
  if (event.key === 'Tab') keepFocusInside(event);
}

onMounted(async () => {
  previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onKeydown);
  await nextTick();
  // Primeiro campo do formulário: o nome no cadastro, o e-mail no login.
  dialog.value?.querySelector('input')?.focus();
});

onUnmounted(() => {
  document.body.style.overflow = previousBodyOverflow;
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <div
        ref="dialog"
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <header class="modal__header">
          <div>
            <p class="eyebrow">$ vigia {{ isSignUp ? 'cadastro' : 'login' }}</p>
            <h2 id="modal-title" class="modal__title">{{ title }}</h2>
          </div>
          <button class="modal__close" type="button" aria-label="Fechar" @click="emit('close')">
            ×
          </button>
        </header>

        <form class="form" novalidate @submit.prevent="submit">
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

          <button class="button button--primary modal__submit" type="submit" :disabled="submitting">
            <span v-if="submitting" class="spinner" aria-hidden="true"></span>
            {{ submitting ? 'Aguarde…' : submitLabel }}
          </button>
        </form>

        <p class="modal__switch">
          <template v-if="isSignUp">
            Já tem conta?
            <button class="link-button" type="button" @click="switchTo('entrar')">Entrar</button>
          </template>
          <template v-else>
            Ainda não tem conta?
            <button class="link-button" type="button" @click="switchTo('cadastro')">Criar conta</button>
          </template>
        </p>
      </div>
    </div>
  </Teleport>
</template>
