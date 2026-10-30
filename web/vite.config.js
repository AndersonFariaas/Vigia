import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Em desenvolvimento o painel roda aqui e a API roda em 127.0.0.1:3000.
// O proxy evita CORS e mantém o mesmo caminho /api do modo de produção.
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
  build: {
    outDir: 'dist',
  },
});
