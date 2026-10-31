<script setup>
import { nextTick, ref, watch } from 'vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  // Documento a mostrar: o objeto TERMOS ou PRIVACIDADE de legal.js.
  doc: { type: Object, required: true },
});
const emit = defineEmits(['close']);

const dialog = ref(null);
let previousBodyOverflow = '';

function onKeydown(event) {
  if (event.key === 'Escape') emit('close');
}

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) {
      document.body.style.overflow = previousBodyOverflow;
      document.removeEventListener('keydown', onKeydown);
      return;
    }
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeydown);
    await nextTick();
    dialog.value?.querySelector('button')?.focus();
  },
);
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog" appear>
      <div v-if="open" class="dialog-overlay" @click.self="emit('close')">
        <div ref="dialog" class="dialog" role="dialog" aria-modal="true" :aria-label="doc.titulo">
          <button class="dialog__close" type="button" aria-label="Fechar" @click="emit('close')">×</button>

          <article class="auth-card legal">
            <h3 class="auth-card__title">{{ doc.titulo }}</h3>
            <p class="legal__meta">Rascunho. Revise antes de publicar.</p>

            <section v-for="secao in doc.secoes" :key="secao.titulo" class="legal__section">
              <h4 class="legal__title">{{ secao.titulo }}</h4>
              <p v-for="(paragrafo, index) in secao.texto" :key="index" class="legal__text">{{ paragrafo }}</p>
            </section>
          </article>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
