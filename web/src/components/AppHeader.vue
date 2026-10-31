<script setup>
import { computed } from 'vue';
import { PRODUCT_NAME } from '../brand.js';

const props = defineProps({
  user: { type: Object, default: null },
  // true = API respondeu, false = não respondeu, null = ainda verificando.
  apiOnline: { type: Boolean, default: null },
  theme: { type: String, required: true },
  collapsed: { type: Boolean, default: false },
});

defineEmits(['open-auth', 'open-account', 'logout', 'toggle-theme']);

const apiLabel = computed(() => {
  if (props.apiOnline === null) return 'verificando API…';
  return props.apiOnline ? 'API online' : 'API offline';
});
</script>

<template>
  <header class="site-header" :class="{ 'site-header--hidden': collapsed }">
    <div class="topbar">
      <h1 class="brand">
        <svg class="brand__icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <path
            d="M3 16 C8 8.5 24 8.5 29 16 C24 23.5 8 23.5 3 16 Z"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linejoin="round"
          />
          <circle cx="16" cy="16" r="5.2" fill="currentColor" />
          <circle cx="16" cy="16" r="2.2" class="brand__pupil" />
        </svg>{{ PRODUCT_NAME }}
        <span class="brand__hint">Monitor de páginas com alerta por e-mail</span>
      </h1>

      <nav v-if="!user" class="nav" aria-label="Principal">
        <a href="#como-funciona">Como funciona</a>
        <a href="#recursos">Recursos</a>
        <a href="#exemplos">Exemplos</a>
      </nav>

      <div class="topbar__controls">
        <template v-if="!user">
          <button class="button button--ghost button--small" type="button" @click="$emit('open-auth', 'entrar')">
            Entrar
          </button>
          <button class="button button--primary button--small" type="button" @click="$emit('open-auth', 'cadastro')">
            Criar conta
          </button>
        </template>
        <template v-else>
          <p
            class="status"
            role="status"
            :class="{ 'status--online': apiOnline === true, 'status--offline': apiOnline === false }"
          >
            <span class="status__dot" aria-hidden="true"></span>
            {{ apiLabel }}
          </p>
          <span class="account">{{ user.nome || user.email }}</span>
          <button class="button button--ghost button--small" type="button" @click="$emit('open-account')">
            Minha conta
          </button>
          <button class="button button--ghost button--small" type="button" @click="$emit('logout')">Sair</button>
        </template>

        <button
          class="theme-toggle"
          type="button"
          :aria-label="theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'"
          :title="theme === 'dark' ? 'Modo claro' : 'Modo escuro'"
          @click="$emit('toggle-theme')"
        >
          <svg
            v-if="theme === 'dark'"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
          <svg
            v-else
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
          >
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          </svg>
        </button>
      </div>
    </div>
  </header>
</template>
