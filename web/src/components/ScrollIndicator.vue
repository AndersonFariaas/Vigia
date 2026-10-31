<script setup>
import { onMounted, onUnmounted, ref } from 'vue';

// Indicador visual da rolagem. Fica por cima da página e não ocupa espaço:
// a rolagem continua funcionando por roda, toque e teclado.
const VISIBLE_MS = 900;
const MIN_THUMB_PX = 40;
const EDGE_PX = 8;

const visible = ref(false);
const hasOverflow = ref(false);
const thumb = ref({ top: EDGE_PX, height: MIN_THUMB_PX });
let hideTimer = null;

function measure() {
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  hasOverflow.value = maxScroll > 0;
  if (!hasOverflow.value) return;

  const track = window.innerHeight - EDGE_PX * 2;
  const height = Math.max(MIN_THUMB_PX, (window.innerHeight / document.documentElement.scrollHeight) * track);
  const ratio = window.scrollY / maxScroll;
  thumb.value = { top: EDGE_PX + ratio * (track - height), height };
}

function onScroll() {
  measure();
  visible.value = true;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    visible.value = false;
  }, VISIBLE_MS);
}

onMounted(() => {
  measure();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', measure);
});

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('resize', measure);
  clearTimeout(hideTimer);
});
</script>

<template>
  <div
    v-if="hasOverflow"
    class="scroll-indicator"
    :class="{ 'scroll-indicator--visible': visible }"
    aria-hidden="true"
  >
    <span class="scroll-indicator__thumb" :style="{ top: `${thumb.top}px`, height: `${thumb.height}px` }"></span>
  </div>
</template>
