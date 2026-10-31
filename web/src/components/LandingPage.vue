<script setup>
import { PRODUCT_NAME } from '../brand.js';
import AuthPanel from './AuthPanel.vue';

defineProps({
  authMode: { type: String, default: 'entrar' },
  aviso: { type: String, default: '' },
});
const emit = defineEmits(['update:authMode', 'autenticado']);

// Leva para o card de acesso já no formulário certo.
function choose(mode) {
  emit('update:authMode', mode);
  document.getElementById('acesso')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
</script>

<template>
  <div class="landing">
    <section class="hero">
      <div class="hero__copy">
        <p class="pill">Monitor de páginas com alerta por e-mail</p>
        <h2 class="hero__title">
          Saiba o que mudou nas páginas que <span class="hero__highlight">importam</span>.
        </h2>
        <p class="hero__lead">
          O {{ PRODUCT_NAME }} compara cada checagem, mostra a diferença linha a linha e avisa por e-mail.
          Também sinaliza formulários de senha suspeitos e domínios que imitam marcas conhecidas.
        </p>

        <div class="hero__actions">
          <button class="button button--primary" type="button" @click="choose('cadastro')">
            Criar conta grátis
          </button>
          <button class="button button--ghost" type="button" @click="choose('entrar')">
            Já tenho conta
          </button>
        </div>

        <ul class="hero__checks">
          <li>Diferença linha a linha</li>
          <li>Sinais de risco</li>
          <li>Alertas no seu e-mail</li>
        </ul>
      </div>

      <div class="hero__visual">
        <figure class="frame">
          <img
            src="/shot-painel.png"
            width="2000"
            height="1200"
            alt="Painel do vigia com páginas monitoradas, um alerta de preço e um risco alto, com dados fictícios"
          />
        </figure>
        <p class="chip chip--alert">Alteração detectada · R$ 49,90 → R$ 39,90</p>
        <p class="chip chip--risk">Risco alto · formulário de senha externo</p>
      </div>
    </section>

    <section id="recursos" class="section">
      <p class="eyebrow">Recursos</p>
      <h2 class="section__title">Feito para ver o que realmente mudou</h2>
      <p class="section__lead">
        Ruído de horário e de token não geram alerta. Você recebe só o que importa, com a diferença explicada.
      </p>

      <div class="features">
        <article class="feature">
          <h3 class="feature__title">Diferença linha a linha</h3>
          <p class="feature__text">Veja exatamente o que entrou e o que saiu, sem abrir a página.</p>
        </article>
        <article class="feature">
          <h3 class="feature__title">Sinais de risco</h3>
          <p class="feature__text">Formulário de senha enviando para outro site, domínio que imita uma marca e certificado vencido.</p>
        </article>
        <article class="feature">
          <h3 class="feature__title">Análise com a Devin</h3>
          <p class="feature__text">Cada alerta pode ser analisado com a Devin, de forma opcional e sob demanda.</p>
        </article>
      </div>
    </section>

    <section id="como-funciona" class="section">
      <p class="eyebrow">Como funciona</p>
      <h2 class="section__title">Três passos para começar</h2>

      <ol class="steps">
        <li class="step">
          <span class="step__number">1</span>
          <h3 class="step__title">Cadastre a página</h3>
          <p class="step__text">Informe o endereço e, se quiser, um nome para reconhecer a página depois.</p>
        </li>
        <li class="step">
          <span class="step__number">2</span>
          <h3 class="step__title">Escolha a frequência</h3>
          <p class="step__text">Entre 15 minutos e 1 dia. A checagem acontece sozinha, sem você precisar lembrar.</p>
        </li>
        <li class="step">
          <span class="step__number">3</span>
          <h3 class="step__title">Receba o alerta</h3>
          <p class="step__text">Quando a página muda, você recebe um e-mail com a diferença e o status da análise.</p>
        </li>
      </ol>
    </section>

    <section id="exemplos" class="section">
      <p class="eyebrow">Exemplos de uso</p>
      <h2 class="section__title">Veja o {{ PRODUCT_NAME }} em funcionamento</h2>

      <div class="example">
        <div class="example__text">
          <h3 class="example__title">Acompanhe suas páginas num só lugar</h3>
          <p class="example__text">
            Veja a lista de páginas, o status de cada uma e o histórico de alertas. Tudo no mesmo painel.
          </p>
        </div>
        <figure class="frame">
          <img src="/shot-painel.png" width="2000" height="1200" alt="Lista de páginas monitoradas, com dados fictícios" />
        </figure>
      </div>

      <div class="example example--reverse">
        <div class="example__text">
          <h3 class="example__title">Receba o que mudou no seu e-mail</h3>
          <p class="example__text">
            O alerta mostra a diferença linha a linha, para você decidir o que fazer sem abrir a página.
          </p>
        </div>
        <figure class="frame">
          <img src="/shot-email.png" width="2000" height="860" alt="E-mail de alerta com a diferença de preço, com dados fictícios" />
        </figure>
      </div>

      <div class="example">
        <div class="example__text">
          <h3 class="example__title">Identifique sinais de risco</h3>
          <p class="example__text">
            Formulários de senha que enviam dados para outro site aparecem como alerta de risco alto.
          </p>
        </div>
        <figure class="frame">
          <img src="/shot-risco.png" width="2000" height="940" alt="Alerta de risco alto por formulário de senha externo, com dados fictícios" />
        </figure>
      </div>
    </section>

    <section id="acesso" class="section section--access">
      <p class="eyebrow">Acesso</p>
      <h2 class="section__title">Comece agora</h2>
      <AuthPanel
        :mode="authMode"
        :aviso="aviso"
        @update:mode="emit('update:authMode', $event)"
        @autenticado="emit('autenticado', $event)"
      />
    </section>

    <footer class="landing-footer">
      <p>
        <strong>{{ PRODUCT_NAME }}</strong> · Acesso por conta com senha. Antes de expor este painel na internet, use HTTPS.
      </p>
      <nav class="landing-footer__links" aria-label="Rodapé">
        <a href="#recursos">Recursos</a>
        <a href="#como-funciona">Como funciona</a>
        <a href="#exemplos">Exemplos</a>
        <a href="#acesso">Acesso</a>
      </nav>
    </footer>
  </div>
</template>
