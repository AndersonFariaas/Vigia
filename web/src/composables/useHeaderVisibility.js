import { computed, onMounted, onUnmounted, ref } from 'vue';

// Só esconde a barra depois de rolar este tanto, para não piscar no topo da página.
const HIDE_AFTER_PX = 120;

/**
 * A barra some ao rolar para baixo e volta ao subir. Com um modal aberto, ela fica visível.
 * Retorna um computed que diz se a barra deve estar recolhida.
 */
export function useHeaderVisibility(modalOpen) {
  const scrolledAway = ref(false);
  let lastY = 0;

  function onScroll() {
    const y = window.scrollY;
    if (y > lastY && y > HIDE_AFTER_PX) scrolledAway.value = true;
    else if (y < lastY) scrolledAway.value = false;
    lastY = Math.max(0, y);
  }

  onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }));
  onUnmounted(() => window.removeEventListener('scroll', onScroll));

  return computed(() => scrolledAway.value && !modalOpen.value);
}
