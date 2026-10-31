<script setup>
import { ref } from 'vue';
import AuthModal from './AuthModal.vue';
import { PRODUCT_NAME } from '../brand.js';

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
  <div class="landing">
    <div class="landing__intro">
      <h2 class="landing__title">Saiba o que mudou nas páginas que importam.</h2>
      <p class="landing__lead">
        O {{ PRODUCT_NAME }} compara cada checagem, mostra a diferença linha a linha e avisa por e-mail.
        Também sinaliza formulários de senha suspeitos e domínios que imitam marcas conhecidas.
      </p>

      <ul class="landing__features">
        <li>Diferença linha a linha, sem ruído de horário ou token</li>
        <li>Sinais de risco: senha enviada para outro site, domínio falso, certificado vencido</li>
        <li>Análise opcional de cada alerta com a Devin</li>
      </ul>

      <figure class="landing__shot">
        <img
          src="/snapshot.png"
          width="2400"
          height="1280"
          alt="Painel do vigia com três páginas monitoradas e um alerta de preço, com dados fictícios"
        />
      </figure>
    </div>

    <section class="auth-card" aria-labelledby="auth-title">
      <h3 id="auth-title" class="auth-card__title">Acesse sua conta</h3>
      <p class="auth-card__text">Entre ou crie uma conta para começar a monitorar.</p>

      <p v-if="aviso" class="message message--info" role="status">{{ aviso }}</p>

      <div class="auth-card__actions">
        <button class="button button--primary" type="button" @click="open('entrar', $event)">
          Entrar
        </button>
        <button class="button button--ghost" type="button" @click="open('cadastro', $event)">
          Criar conta
        </button>
      </div>
    </section>

    <AuthModal
      v-if="modalMode"
      :mode="modalMode"
      @close="close"
      @autenticado="onAuthenticated"
    />
  </div>
</template>
