<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { api, ApiError } from '../api.js';

const MIN_NAME_LENGTH = 2;
const MIN_PASSWORD_LENGTH = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const props = defineProps({
  open: { type: Boolean, default: false },
  user: { type: Object, required: true },
});
const emit = defineEmits(['close', 'updated']);

const dialog = ref(null);
const form = reactive({ nome: '', email: '', senhaAtual: '', novaSenha: '', confirmation: '' });
const errors = reactive({ nome: '', email: '', senhaAtual: '', novaSenha: '', confirmation: '', general: '' });
const submitting = ref(false);

const emailChanged = computed(() => form.email.trim() !== props.user.email);
const passwordChanged = computed(() => form.novaSenha.length > 0);
const nameChanged = computed(() => form.nome.trim() !== (props.user.nome ?? ''));
const nothingChanged = computed(() => !emailChanged.value && !passwordChanged.value && !nameChanged.value);

function fillFromUser() {
  form.nome = props.user.nome ?? '';
  form.email = props.user.email;
  form.senhaAtual = '';
  form.novaSenha = '';
  form.confirmation = '';
  clearErrors();
}

function clearErrors() {
  for (const key of Object.keys(errors)) errors[key] = '';
}

function validate() {
  clearErrors();
  if (form.nome.trim().length < MIN_NAME_LENGTH) {
    errors.nome = `Informe seu nome (mínimo de ${MIN_NAME_LENGTH} caracteres).`;
  }
  if (!EMAIL_PATTERN.test(form.email.trim())) {
    errors.email = 'Informe um e-mail válido.';
  }
  if (passwordChanged.value && form.novaSenha.length < MIN_PASSWORD_LENGTH) {
    errors.novaSenha = `A nova senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (passwordChanged.value && form.confirmation !== form.novaSenha) {
    errors.confirmation = 'As senhas não coincidem.';
  }
  if ((emailChanged.value || passwordChanged.value) && !form.senhaAtual) {
    errors.senhaAtual = 'Informe a senha atual para trocar e-mail ou senha.';
  }
  return !Object.values(errors).some(Boolean);
}

function messageOf(error) {
  // A API devolve detalhes de validação já legíveis; priorizamos eles.
  if (error instanceof ApiError && error.details.length) return error.details.join(' ');
  return error.message;
}

async function submit() {
  if (nothingChanged.value) {
    emit('close');
    return;
  }
  if (!validate()) return;

  // Só envia o que mudou: a API trata cada campo com as suas regras.
  const payload = {};
  if (nameChanged.value) payload.nome = form.nome.trim();
  if (emailChanged.value) payload.email = form.email.trim();
  if (passwordChanged.value) payload.novaSenha = form.novaSenha;
  if (emailChanged.value || passwordChanged.value) payload.senhaAtual = form.senhaAtual;

  submitting.value = true;
  try {
    const { user } = await api.updateAccount(payload);
    emit('updated', user);
  } catch (error) {
    errors.general = messageOf(error);
  } finally {
    submitting.value = false;
  }
}

function onKeydown(event) {
  if (event.key === 'Escape' && !submitting.value) emit('close');
}

let previousBodyOverflow = '';
watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) {
      document.body.style.overflow = previousBodyOverflow;
      document.removeEventListener('keydown', onKeydown);
      return;
    }
    fillFromUser();
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeydown);
    await nextTick();
    dialog.value?.querySelector('input')?.focus();
  },
);
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog" appear>
      <div v-if="open" class="dialog-overlay" @click.self="emit('close')">
        <div ref="dialog" class="dialog" role="dialog" aria-modal="true" aria-labelledby="account-title">
          <button class="dialog__close" type="button" aria-label="Fechar" @click="emit('close')">×</button>

          <section class="auth-card">
            <h3 id="account-title" class="auth-card__title">Minha conta</h3>
            <p class="auth-card__text">
              Altere seus dados. Para trocar o e-mail ou a senha, confirme a senha atual.
            </p>

            <form class="auth-form" novalidate @submit.prevent="submit">
              <div class="field">
                <label class="field__label" for="account-nome">Nome</label>
                <input
                  id="account-nome"
                  v-model="form.nome"
                  class="input"
                  type="text"
                  autocomplete="name"
                  maxlength="80"
                  :aria-invalid="Boolean(errors.nome)"
                  :disabled="submitting"
                />
                <span v-if="errors.nome" class="field__error">{{ errors.nome }}</span>
              </div>

              <div class="field">
                <label class="field__label" for="account-email">E-mail</label>
                <input
                  id="account-email"
                  v-model="form.email"
                  class="input"
                  type="email"
                  autocomplete="email"
                  spellcheck="false"
                  :aria-invalid="Boolean(errors.email)"
                  :disabled="submitting"
                />
                <span v-if="errors.email" class="field__error">{{ errors.email }}</span>
              </div>

              <div class="field">
                <label class="field__label" for="account-senha-atual">Senha atual</label>
                <input
                  id="account-senha-atual"
                  v-model="form.senhaAtual"
                  class="input"
                  type="password"
                  autocomplete="current-password"
                  :aria-invalid="Boolean(errors.senhaAtual)"
                  :disabled="submitting"
                />
                <span v-if="errors.senhaAtual" class="field__error">{{ errors.senhaAtual }}</span>
              </div>

              <div class="auth-form__pair">
                <div class="field">
                  <label class="field__label" for="account-nova-senha">Nova senha</label>
                  <input
                    id="account-nova-senha"
                    v-model="form.novaSenha"
                    class="input"
                    type="password"
                    autocomplete="new-password"
                    :aria-invalid="Boolean(errors.novaSenha)"
                    :disabled="submitting"
                  />
                  <span v-if="errors.novaSenha" class="field__error">{{ errors.novaSenha }}</span>
                </div>

                <div class="field">
                  <label class="field__label" for="account-confirmacao">Confirme a nova senha</label>
                  <input
                    id="account-confirmacao"
                    v-model="form.confirmation"
                    class="input"
                    type="password"
                    autocomplete="new-password"
                    :aria-invalid="Boolean(errors.confirmation)"
                    :disabled="submitting"
                  />
                  <span v-if="errors.confirmation" class="field__error">{{ errors.confirmation }}</span>
                </div>
              </div>

              <p v-if="errors.general" class="message message--error" role="alert">{{ errors.general }}</p>

              <button class="button button--primary" type="submit" :disabled="submitting">
                <span v-if="submitting" class="spinner" aria-hidden="true"></span>
                {{ submitting ? 'Salvando…' : 'Salvar alterações' }}
              </button>
            </form>
          </section>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
