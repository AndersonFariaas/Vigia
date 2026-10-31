<script setup>
import { nextTick, onUnmounted, ref, watch } from 'vue';
import AuthPanel from './AuthPanel.vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  mode: { type: String, default: 'entrar' },
  aviso: { type: String, default: '' },
});
const emit = defineEmits(['update:mode', 'close', 'autenticado']);

const dialog = ref(null);
let previousFocus = null;
let previousBodyOverflow = '';

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
  if (event.key === 'Escape') emit('close');
  if (event.key === 'Tab') keepFocusInside(event);
}

function lock() {
  previousFocus = document.activeElement;
  previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onKeydown);
}

function unlock() {
  document.body.style.overflow = previousBodyOverflow;
  document.removeEventListener('keydown', onKeydown);
  previousFocus?.focus?.();
}

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) {
      unlock();
      return;
    }
    lock();
    await nextTick();
    // Primeiro campo do formulário aberto.
    dialog.value?.querySelector('input')?.focus();
  },
);

onUnmounted(() => {
  if (props.open) unlock();
});
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog" appear>
      <div v-show="open" class="dialog-overlay" @click.self="emit('close')">
        <div ref="dialog" class="dialog" role="dialog" aria-modal="true" aria-label="Acesso à conta">
          <button class="dialog__close" type="button" aria-label="Fechar" @click="emit('close')">×</button>
          <AuthPanel
            :mode="mode"
            :aviso="aviso"
            @update:mode="emit('update:mode', $event)"
            @autenticado="emit('autenticado', $event)"
          />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
