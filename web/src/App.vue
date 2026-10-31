<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { api, messageOf, SESSION_EXPIRED_EVENT } from './api.js';
import AppHeader from './components/AppHeader.vue';
import LandingPage from './components/LandingPage.vue';
import AuthDialog from './components/AuthDialog.vue';
import AccountDialog from './components/AccountDialog.vue';
import MonitorForm from './components/MonitorForm.vue';
import MonitorCard from './components/MonitorCard.vue';
import ScrollIndicator from './components/ScrollIndicator.vue';
import { useHeaderVisibility } from './composables/useHeaderVisibility.js';
import { useTheme } from './composables/useTheme.js';

const { theme, initTheme, toggleTheme, disposeTheme } = useTheme();
const apiOnline = ref(null);

// Lista de monitores da conta logada. Cada cartão cuida da própria checagem e do histórico.
const monitors = ref([]);
const listState = ref('loading');
const listError = ref('');

// `sessionChecked` evita piscar o formulário de login antes de saber se há sessão.
const user = ref(null);
const sessionChecked = ref(false);
const sessionNotice = ref('');

// Modal de acesso: aberto pelo menu ou pelos botões da página inicial, no modo escolhido.
const authMode = ref('entrar');
const authOpen = ref(false);
// Modal "Minha conta", aberto pelo cabeçalho quando a pessoa está logada.
const accountOpen = ref(false);

const headerCollapsed = useHeaderVisibility(computed(() => authOpen.value || accountOpen.value));

function goToAuth(mode) {
  authMode.value = mode;
  authOpen.value = true;
}

function forgetAccount() {
  user.value = null;
  monitors.value = [];
}

function onAccountUpdated(updated) {
  user.value = updated;
  accountOpen.value = false;
}

// Conta excluída: volta para a página inicial, com o aviso no modal de acesso.
function onAccountDeleted() {
  accountOpen.value = false;
  forgetAccount();
  sessionNotice.value = 'Sua conta foi excluída.';
  authOpen.value = true;
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

function addMonitor(created) {
  monitors.value.unshift(created);
}

function replaceMonitor(updated) {
  const index = monitors.value.findIndex((item) => item.id === updated.id);
  if (index !== -1) monitors.value[index] = updated;
}

function removeMonitor(id) {
  monitors.value = monitors.value.filter((item) => item.id !== id);
}

async function restoreSession() {
  try {
    user.value = (await api.session()).user;
  } catch {
    // Sem sessão válida: a página inicial e o formulário de entrada aparecem.
    user.value = null;
  } finally {
    sessionChecked.value = true;
  }
  if (user.value) loadMonitors();
}

function onAuthenticated(account) {
  user.value = account;
  sessionNotice.value = '';
  authOpen.value = false;
  loadMonitors();
}

async function logout() {
  try {
    await api.logout();
  } catch {
    // O cookie expira sozinho; a tela esquece a conta mesmo assim.
    console.warn('Não foi possível encerrar a sessão no servidor.');
  }
  forgetAccount();
}

function onSessionExpired() {
  if (!user.value) return;
  forgetAccount();
  sessionNotice.value = 'Sua sessão expirou. Entre de novo para continuar.';
  authOpen.value = true;
}

onMounted(() => {
  initTheme();
  checkHealth();
  restoreSession();
  window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
});

onUnmounted(() => {
  window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
  disposeTheme();
});
</script>

<template>
  <AppHeader
    :user="user"
    :api-online="apiOnline"
    :theme="theme"
    :collapsed="headerCollapsed"
    @open-auth="goToAuth"
    @open-account="accountOpen = true"
    @logout="logout"
    @toggle-theme="toggleTheme"
  />

  <ScrollIndicator />

  <div class="app">
    <LandingPage v-if="sessionChecked && !user" @open-auth="goToAuth" />

    <AuthDialog
      v-if="sessionChecked && !user"
      :open="authOpen"
      :mode="authMode"
      :aviso="sessionNotice"
      @update:mode="authMode = $event"
      @close="authOpen = false"
      @autenticado="onAuthenticated"
    />

    <AccountDialog
      v-if="user"
      :open="accountOpen"
      :user="user"
      @close="accountOpen = false"
      @updated="onAccountUpdated"
      @deleted="onAccountDeleted"
    />

    <MonitorForm v-if="user" @created="addMonitor" />

    <section v-if="user" aria-labelledby="monitors-title">
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
        <MonitorCard
          v-for="monitor in monitors"
          :key="monitor.id"
          :monitor="monitor"
          @updated="replaceMonitor"
          @removed="removeMonitor"
        />
      </TransitionGroup>
    </section>

    <p v-if="user" class="card__note" style="margin-top: 32px">
      Acesso por conta com senha. Antes de expor este painel na internet, use HTTPS.
    </p>
  </div>
</template>
