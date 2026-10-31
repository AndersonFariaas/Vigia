import { ref } from 'vue';

const STORAGE_KEY = 'vigia-theme';
// Duração da transição de cor. Depois disso a classe que a liga é removida.
const TRANSITION_MS = 300;

function readSavedTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : null;
  } catch {
    // Armazenamento bloqueado: vale a preferência do sistema.
    return null;
  }
}

function saveTheme(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Modo privado ou armazenamento bloqueado: a escolha vale só nesta sessão.
  }
}

/**
 * Tema claro ou escuro. Sem escolha salva, segue o sistema. Só a troca manual é gravada,
 * para que a preferência do sistema continue valendo até a pessoa escolher.
 */
export function useTheme() {
  const theme = ref('light');
  let transitionTimer = null;

  function apply(value) {
    theme.value = value;
    document.documentElement.dataset.theme = value;
  }

  function initTheme() {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    apply(readSavedTheme() ?? (prefersDark ? 'dark' : 'light'));
  }

  function toggleTheme() {
    // A classe liga a transição de cor só durante a troca. Assim, a página não anima ao carregar.
    const root = document.documentElement;
    root.classList.add('theme-switching');
    const next = theme.value === 'dark' ? 'light' : 'dark';
    apply(next);
    saveTheme(next);

    window.clearTimeout(transitionTimer);
    transitionTimer = window.setTimeout(() => root.classList.remove('theme-switching'), TRANSITION_MS);
  }

  function disposeTheme() {
    window.clearTimeout(transitionTimer);
  }

  return { theme, initTheme, toggleTheme, disposeTheme };
}
