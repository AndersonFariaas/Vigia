# Vigia

Monitor de páginas públicas. Quando o conteúdo muda, o Vigia cria um alerta e envia um e-mail com o que mudou.

Projeto da **Hack Brasil 2026**. Este README explica não só como rodar, mas **por que** cada decisão foi tomada, para servir de material de estudo.

> **Status:** Fase 3 (contas com senha e múltiplos usuários) e a parte de LGPD da Fase 4 (termos, retenção de 90 dias e exclusão de conta) implementadas. Planos, cobrança e a Fase 5 estão descritos no fim.

---

## Sumário

- [Como rodar](#como-rodar)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Arquitetura](#arquitetura)
- [Decisões principais (e o porquê)](#decisões-principais-e-o-porquê)
- [API](#api)
- [Testes](#testes)
- [Hack Brasil: requisitos e pendências](#hack-brasil-requisitos-e-pendências)
- [Limitações conhecidas](#limitações-conhecidas)
- [Próximas fases](#próximas-fases)

---

## Como rodar

Requisitos: **Node.js 22.13 ou superior** (o banco usa o módulo nativo `node:sqlite`, sem compilação).

Instalação e banco:

```bash
npm install
```

```bash
cp .env.example .env
```

Preencha o `.env` (veja [Variáveis de ambiente](#variáveis-de-ambiente)) e crie o banco:

```bash
npm run migrate
```

Crie sua conta pelo painel, na tela **Criar conta**. Se você já tinha a conta da Fase 1 (sem senha), defina a senha dela pelo terminal:

```bash
npm run usuario -- seu-email@exemplo.com
```

A senha aparece enquanto é digitada, então rode o comando sem ninguém olhando.

Em desenvolvimento, use dois terminais: a API e o painel.

```bash
npm run dev
```

```bash
npm run web:install && npm run web:dev
```

Abra `http://localhost:5173`. O Vite faz proxy de `/api` para `127.0.0.1:3000`.

Em produção, gere o painel e suba só o servidor. Ele serve o `web/dist`:

```bash
npm run web:build
```

```bash
NODE_ENV=production npm start
```

Rodar os testes (não precisam de rede nem de chaves):

```bash
npm test
```

---

## Variáveis de ambiente

As variáveis são validadas na inicialização. **Se faltar alguma, o servidor não sobe**, e a mensagem lista todos os problemas de uma vez.

| Variável | Obrigatória | Padrão | Para quê |
|---|---|---|---|
| `FIRECRAWL_API_KEY` | sim | | Coleta das páginas em markdown |
| `FIRECRAWL_BASE_URL` | não | `https://api.firecrawl.dev` | Endpoint da Firecrawl |
| `RESEND_API_KEY` | sim | | Envio dos e-mails de alerta |
| `ALERT_EMAIL_FROM` | sim | | Remetente (precisa de domínio verificado na Resend) |
| `DEVIN_API_KEY` | sim | | Chave de service user da Devin (começa com `cog_`) |
| `DEVIN_ORG_ID` | sim | | ID da organização na Devin (começa com `org-`) |
| `DEVIN_MAX_ACU_LIMIT` | não | `2` | Teto de consumo por análise, em ACUs (1 a 10) |
| `CHECK_CRON` | não | `*/15 * * * *` | Quando o agendador roda |
| `CADASTRO_ABERTO` | não | `true` | Permite criar contas novas. Com `false`, só contas existentes entram |
| `DATABASE_PATH` | não | `./data/vigia.db` | Arquivo SQLite |
| `HOST` | não | `127.0.0.1` | Interface de escuta |
| `PORT` | não | `3000` | Porta da API |

> **Segredos:** o `.env` está no `.gitignore`. Nunca faça commit dele. Se uma chave vazar, revogue-a no painel do provedor e gere outra.

---

## Arquitetura

```
src/
├── config/env.js            validação das variáveis (zod)
├── security/
│   ├── urlValidator.js      regras da URL (esquema, porta, credenciais)
│   └── ssrfGuard.js         bloqueia destinos internos (DNS + faixas de IP)
├── services/
│   ├── checker.js           fluxo de uma checagem (o "cérebro")
│   ├── scraper/
│   │   ├── firecrawlClient.js   coleta com retentativa seletiva
│   │   └── normalize.js         remove ruído antes do hash
│   ├── diff/
│   │   ├── hash.js          SHA-256
│   │   └── textDiff.js      linhas adicionadas e removidas
│   ├── detectors/           sinais de risco: formulários, scripts, certificado e domínios parecidos
│   │   ├── pageSignals.js   lê formulários e scripts do HTML (parse5)
│   │   ├── risks.js         transforma sinais em riscos com chave estável
│   │   ├── lookalike.js     compara o domínio com marcas conhecidas (distância de edição)
│   │   ├── certificate.js   lê a validade do certificado TLS
│   │   └── referenceDomains.js  lista de domínios oficiais (editável)
│   ├── notifier/
│   │   ├── resendClient.js  envio pela Resend
│   │   └── dispatcher.js    monta o e-mail (com escape) e envia o lote
│   └── scheduler/jobs.js    agendador e rodada
├── db/
│   ├── index.js             abre o SQLite (WAL, chaves estrangeiras)
│   ├── migrate.js           aplica as migrations, uma vez cada
│   ├── migrations/001_init.sql
│   └── repositories/        acesso a dados, separado por tabela
├── routes/monitors.routes.js
├── app.js                   monta o Express (não sobe servidor)
└── server.js                ponto de entrada: liga tudo
web/                         painel Vue 3 + Vite
tests/                       unit/ (sem I/O) e integration/ (banco em memória)
```

A ideia central é um **fluxo em camadas com dependências injetadas**. O `checker` recebe a raspagem, a checagem de SSRF e os repositórios como parâmetros. Em produção, o `server.js` passa as implementações reais; nos testes, passamos versões falsas. Por isso a suíte roda sem rede e sem chaves.

### O fluxo de uma checagem

```
URL ──► validação ──► SSRF ──► raspagem ──► normalização ──► hash ──► comparação
                                  (retenta)                           │
                                                 ┌────────────────────┼────────────────────┐
                                                 ▼                    ▼                    ▼
                                         sem snapshot          hash igual            hash diferente
                                         grava referência      registra "ok"        grava snapshot, diff,
                                         (sem alerta)          (sem alerta)         alerta pendente
```

Cada etapa falha de forma previsível. A mensagem gravada no monitor é sempre a **sanitizada**, nunca o erro cru.

---

## Decisões principais (e o porquê)

### 1. Configuração validada na partida, não na primeira requisição

Um erro de configuração descoberto só quando alguém clica em "Checar" é uma bomba-relógio. Validando com `zod` no início, o problema aparece na hora, com a lista completa. A mensagem nunca mostra os valores dos segredos.

### 2. SQLite com `node:sqlite`, sem `better-sqlite3`

`better-sqlite3` precisa compilar código nativo, o que quebra em máquinas sem as ferramentas de build. O `node:sqlite` vem com o Node e não tem dependência nativa. Duas configurações importam:

- **WAL:** leituras do painel não travam a escrita do agendador.
- **`foreign_keys = ON`:** o SQLite **ignora** `ON DELETE CASCADE` por padrão. Sem esta linha, apagar um monitor deixaria snapshots órfãos.

### 3. Contas com senha, e cada conta vê só o próprio

Cada usuário entra com e-mail e senha. Todas as consultas de monitores e alertas filtram por `req.user.id`, vindo da sessão, nunca de algo que o cliente envia. A única consulta sem usuário é `findDue`, usada pelo agendador e proibida em rotas. Os testes de isolamento tentam ler, checar e remover o monitor de outra conta, e recebem 404 em todos os casos.

- **Senha:** `scrypt` do próprio Node, sem pacote nativo. Os parâmetros ficam no hash, então dá para aumentar o custo no futuro sem quebrar contas antigas. A resposta de login é a mesma para e-mail desconhecido e senha errada, e o tempo também é parecido.
- **Sessão:** token aleatório de 256 bits no cookie `HttpOnly` e `SameSite=Strict`. No banco fica só o hash do token. Vale 7 dias, e `Secure` liga em produção.
- **Limite:** no login e no cadastro, 10 tentativas por IP a cada 15 minutos.
- **Alertas:** cada alerta vai para o e-mail do dono do monitor.

### 4. SSRF: validar **todos** os IPs do domínio

Um usuário pode cadastrar `https://meu-site.com` apontando para `169.254.169.254` (metadados de nuvem) ou para `10.0.0.5` (rede interna). O guard resolve o domínio com `dns.lookup({ all: true })` e bloqueia se **qualquer** IP for privado. Basta um para bloquear, porque o cliente HTTP pode acabar usando qualquer um deles.

Também cobrimos o que costuma escapar:

- **IPv4 mapeado em IPv6** (`::ffff:127.0.0.1`): o endereço embutido é verificado, não o prefixo.
- **Formas em hexadecimal** (`::ffff:7f00:1`): o IP é expandido para 8 grupos antes de comparar, porque a forma textual tem várias grafias.
- **NAT64 e 6to4:** podem levar a um IPv4 interno, então são bloqueados.
- **Em dúvida, bloqueia:** um endereço que não entendemos é tratado como privado.

> **Limite honesto:** isto valida o domínio **antes** da requisição. A Firecrawl faz a conexão real na infraestrutura dela, então um DNS que mude de resposta entre a checagem e a coleta (*DNS rebinding*) não é coberto. Ver [Limitações](#limitações-conhecidas).

### 5. Normalização antes do hash

Sem normalização, a página "muda" a cada minuto por causa de um horário, uma data ou um token de sessão, e o usuário para de confiar nos alertas. O `normalize.js` remove:

- datas (`dd/mm/aaaa` e ISO 8601), horários (`14:32`, `2:05 pm`, `14h32`);
- tokens hexadecimais com 16 ou mais caracteres;
- parâmetros de cache na URL (`?v=`, `?_=`, `?t=`…);
- espaços extras e linhas vazias.

O cuidado é o **outro lado**: um preço de `R$ 49,90` que vira `R$ 39,90` **continua gerando alerta**. Os testes verificam os dois casos.

### 6. Hash para decidir, diff para explicar

O SHA-256 do texto normalizado responde rápido a "mudou ou não?". O diff por conjunto de linhas responde "o que mudou?", com até 5 linhas adicionadas e 5 removidas no alerta. Usamos conjunto e não diff de posição porque reordenar itens costuma ser ruído de layout.

### 7. Retentativa seletiva

Retentar tudo é um erro comum. Um `402` (sem créditos) não muda ao repetir a requisição; retentar só gasta tempo e, em alguns casos, cota. A política:

| Resposta | Retenta? | Por quê |
|---|---|---|
| 429, 5xx, erro de rede, timeout | sim (2s, 8s) | são problemas passageiros |
| 401, 403, 402, 4xx | não | a condição não muda sozinha |

Os atrasos são curtos de propósito: a rodada checa 20 monitores em sequência, e esperar mais travaria o lote inteiro.

### 8. Escape de todo conteúdo externo no e-mail

A página monitorada **não é confiável**. Um atacante pode colocar `<script>` ou uma imagem com `onerror` no texto da página, e esse texto chega ao e-mail. Por isso todo valor passa por `escapeHtml`: o conteúdo da página, o nome do monitor e a URL. Há um teste que confirma que `<script>` vira texto, não tag.

Também **não** repassamos o corpo da resposta da Resend nos erros: ele pode ecoar o e-mail ou dados da conta.

### 9. Agendador que não se atropela

O `runRound` tem uma flag `running`. Se a rodada anterior ainda está rodando (uma checagem com retentativas pode levar até ~100 segundos), a próxima é **ignorada**, e não empilhada. Além disso, uma checagem manual e a do agendador para o mesmo monitor não rodam ao mesmo tempo (`inFlight`), porque isso geraria alertas duplicados.

### 10. Transações onde a consistência importa

Gravar o snapshot, podar os antigos, criar o alerta e atualizar o monitor **acontecem juntos** numa transação. Se a energia cair no meio, nenhum deles fica sem os outros.

### 11. Análise com a Devin: sob demanda, com teto e sem repositório

A Devin entra como **análise de um alerta**, disparada pelo usuário no botão "Analisar com Devin". O motivo de não ser automática: cada sessão consome créditos, e uma página que muda a cada hora geraria custo sem valor. Quando o usuário clica:

- o prompt contém o resumo do diff dentro de um bloco de dados marcado, com a instrução de **não obedecer** o que estiver ali. Uma página maliciosa poderia escrever instruções para o agente, então o prompt também remove qualquer tentativa de fechar esse bloco;
- a sessão **não recebe repositório** e `bypass_approval` fica `false`, então qualquer ação do agente exige aprovação humana;
- `max_acu_limit` limita o consumo por análise (configurável);
- o POST **não é retentado**: se der timeout, repetir poderia criar duas sessões e cobrar duas vezes;
- cada alerta tem no máximo uma análise (`UNIQUE` no banco), e um duplo clique não cria outra, porque a rota recusa a segunda chamada enquanto a primeira está em andamento;
- a URL da sessão só é aceita se for `https`, porque ela vira link no painel.

### 12. Painel sem `v-html`

Todo texto da página, do alerta ou do erro é exibido por interpolação do Vue, que escapa automaticamente. Os links usam `rel="noopener noreferrer"`.

### 13. Alerta de risco só quando algo é novo

Cada leitura gera um conjunto de **riscos com chave estável** (por exemplo, `senha-externa:dominio.net`). Um alerta só sai quando a chave aparece e não estava na leitura anterior. Assim, um site que continua com o mesmo risco não gera um alerta a cada checagem.

Riscos que já valem na primeira leitura (senha enviada para outro domínio, domínio que imita uma marca, certificado vencido) alertam de cara. Riscos de mudança (campo de senha novo, script de outro domínio) só alertam depois da referência. Sem essa distinção, um login oficial alertaria só por existir.

Leituras feitas antes da Fase 2 não guardam a lista de riscos. Nelas, a primeira checagem apenas registra o estado, sem alertar.

---

## API

Todas as respostas de erro são JSON, sem stack trace. O corpo é limitado a 10 KB e o `x-powered-by` está desligado.

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/health` | Status da API |
| `POST` | `/api/auth/cadastro` | Cria a conta (nome, e-mail, senha e aceite dos termos) e abre a sessão (403 se o cadastro estiver fechado; 429 após muitas tentativas) |
| `POST` | `/api/auth/entrar` | Abre a sessão (401 com mensagem genérica se as credenciais não batem) |
| `POST` | `/api/auth/sair` | Encerra a sessão |
| `PATCH` | `/api/auth/conta` | Altera nome, e-mail ou senha. Trocar a senha exige a senha atual |
| `DELETE` | `/api/auth/conta` | Exclui a conta e todos os dados dela (monitores, snapshots e alertas), com a senha atual |
| `GET` | `/api/auth/sessao` | Usuário da sessão atual, ou 401 |
| `GET` | `/api/monitors` | Lista os monitores |
| `POST` | `/api/monitors` | Cadastra (valida URL e SSRF; 409 se duplicado) |
| `POST` | `/api/monitors/:id/check` | Checagem imediata |
| `GET` | `/api/monitors/:id/snapshots` | Últimos snapshots (sem o texto completo) |
| `GET` | `/api/monitors/:id/alerts` | Últimos alertas com o diff |
| `POST` | `/api/monitors/:id/alerts/:alertId/analyze` | Abre a análise do alerta na Devin (201; 200 se já existe; 502 se a Devin falhar) |
| `DELETE` | `/api/monitors/:id` | Remove, com cascata |

Exemplo de cadastro:

```bash
curl -X POST http://127.0.0.1:3000/api/monitors -H "Content-Type: application/json" -d "{\"url\": \"https://exemplo.com/precos\", \"label\": \"Preço X\", \"intervalMinutes\": 60}"
```

Códigos principais: `400` (dados ou URL inválidos, SSRF), `404` (monitor ou rota inexistente), `409` (duplicado ou já em verificação), `413` (corpo grande demais).

---

## Testes

```bash
npm test
```

A suíte roda com `node:test` nativo, sem Jest, e cobre:

- **Segurança:** IPv4 e IPv6 privados e públicos, IPv4 mapeado, `localhost`, sufixos `.internal`, validação de URL (`file://`, `ftp://`, credenciais, porta fora do padrão, hostname sem ponto, URL longa).
- **Normalização:** horário, data e token que mudam não geram diferença; mudança real de preço continua visível.
- **Hash e diff:** determinismo, 64 caracteres hexadecimais, limite de 5 linhas na amostra.
- **Checagem** (banco em memória, com fetch falso): referência, sem mudança, mudança com alerta, ruído ignorado, bloqueio de SSRF sem chamar a Firecrawl, retentativa em 503, sem retentativa em 402, status gravado, limite de 50 snapshots.
- **Envio:** pendentes viram enviados; falha em um item não derruba o lote.
- **API:** SSRF e `file://` retornam 400, intervalo inválido 400, JSON malformado 400 sem stack, rota inexistente 404 JSON, helmet ativo, ID inválido 400.

---

## Hack Brasil: requisitos e pendências

O site da hackathon (hackbrasil.com) exige que **todo projeto implemente Firecrawl, Resend e Devin**. Outros pontos verificados no site e nos termos:

| Item | Situação no Vigia |
|---|---|
| Firecrawl | Implementado (coleta das páginas) |
| Resend | Implementado (alertas por e-mail) |
| Devin | Implementado: análise sob demanda de cada alerta (ver decisão 11) |
| Repositório **público** no GitHub | Exigido. Antes de publicar, confirme que o `.env` não está no histórico |
| Demo funcionando | Necessária para a avaliação |
| Critérios de avaliação | execução técnica, uso das ferramentas dos parceiros, impacto e qualidade do pitch |
| Fase online | 04/11 a 30/11/2026 |
| Encerramento das submissões | 30/11/2026 |
| Final presencial | 12/12/2026, Google Brasil (São Paulo) |

Observações:

- A equipe pode ter de 1 a 4 pessoas.
- Os termos não exigem licença específica do código. A propriedade intelectual fica com o time.
- Não há restrição de uso de IA além dos temas proibidos no site.
- Para a conta da Resend, o remetente precisa de domínio verificado. Sem isso, os envios são limitados (em geral, só ao e-mail da própria conta). Confirme a regra atual na documentação da Resend.

---

## Limitações conhecidas

- **DNS rebinding:** o guard de SSRF valida o domínio **antes** da requisição. A Firecrawl conecta na infraestrutura dela, então o risco é reduzido, não eliminado. Fica para a Fase 2.
- **Sem HTTPS dentro do Vigia:** o servidor não faz TLS. Para expor na internet, coloque um proxy com HTTPS na frente.
- **E-mail não verificado:** qualquer pessoa pode cadastrar um endereço e receber alertas dele. A verificação por link fica para a Fase 4.
- **Sem recuperação de senha:** quem esquecer a senha precisa de alguém com acesso ao servidor para rodar `npm run usuario`.
- **Rate limit só no login e no cadastro:** o restante da API não tem limite de requisições. Falta isso antes de expor publicamente.
- **Falha de envio não é reenviada automaticamente:** o alerta fica marcado como `falhou`. Um reenvio manual ou uma fila de retentativa é trabalho da Fase 5.
- **Mudança de conteúdo com severidade fixa "média":** só os riscos da Fase 2 têm severidade própria.
- **Detectores só veem o HTML do servidor:** formulário ou script criado por JavaScript no navegador não aparece na leitura.
- **Lista de marcas curta:** `referenceDomains.js` cobre algumas marcas. Um domínio fora da lista não é comparado.
- **Falsos positivos de domínio parecido:** nomes de marcas comuns (ex.: "amazonas" perto de "amazon") podem ser marcados. Por isso nomes com menos de 5 letras não são comparados.
- **Medição com fixtures sintéticos:** a taxa de falsos positivos e a detecção foram medidas em 4 páginas normais e 3 páginas de golpe criadas para o teste, não em um conjunto real. Os números não generalizam sem mais páginas.
- **Normalização agressiva:** qualquer sequência de 16 ou mais caracteres `a-f`/`0-9` é tratada como hash. Por isso um número longo só com dígitos também sai do texto, e uma mudança nele não gera alerta.
- **Sem histórico completo:** são guardados os 50 últimos snapshots por monitor.
- **Retentativa em timeout:** uma checagem que esbarra em timeouts pode levar até ~100 segundos (três tentativas de 30 s, mais as esperas).

---

## Próximas fases

- **Fase 2 (implementada):** detectores de risco em `src/services/detectors/` (formulário de senha enviando para outro site, campo de senha novo ou com destino alterado, novos scripts de outros domínios, certificado SSL perto do vencimento ou vencido, domínio parecido com marca conhecida), com severidade por risco. Fixtures de golpe e páginas normais em `tests/fixtures/`. Nos fixtures: 0 falsos positivos e 3 de 3 golpes detectados.
- **Fase 3 (implementada):** contas com senha (scrypt), sessão em cookie `HttpOnly`, rate limit por IP no login, no cadastro e nas trocas de senha (só as respostas de erro contam), cada conta isolada das outras e alertas no e-mail do dono.
- **Fase 4 (parcial):** termos de uso com aceite no cadastro, retenção de 90 dias e exclusão de conta (LGPD) implementados. Pendentes: planos com limites e cobrança (Mercado Pago ou Stripe).
- **Fase 5:** logs estruturados, backup, deploy e teste de carga.
