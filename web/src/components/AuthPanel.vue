<script setup>
import { ref } from 'vue';
import AuthModal from './AuthModal.vue';

defineProps({
  aviso: { type: String, default: '' },
});
const emit = defineEmits(['autenticado']);

// Abre o modal no formulário certo. Ao fechar, o foco volta para o botão que o abriu.
const modalMode = ref(null);
const trigger = ref(null);

function open(mode, event) {
  trigger.value = event.currentTarget;
  modalMode.value = mode;
}

function close() {
  modalMode.value = null;
  trigger.value?.focus();
}

function onAuthenticated(user) {
  modalMode.value = null;
  emit('autenticado', user);
}
</script>

<template>
  <section class="auth-card" aria-labelledby="auth-title">
    <p class="eyebrow">$ vigia</p>
    <h2 id="auth-title" class="auth-card__title">Bem-vindo ao Vigia</h2>
    <p class="auth-card__text">
      Acompanhe as páginas que importam para você e receba um e-mail quando algo mudar.
    </p>

    <p v-if="aviso" class="message message--info" role="status">{{ aviso }}</p>

    <div class="auth-card__actions">
      <button class="button button--primary" type="button" @click="open('entrar', $event)">
        Entrar
      </button>
      <button class="button button--ghost" type="button" @click="open('cadastro', $event)">
        Criar conta
      </button>
    </div>

    <AuthModal
      v-if="modalMode"
      :mode="modalMode"
      @close="close"
      @autenticado="onAuthenticated"
    />
  </section>
</template>
