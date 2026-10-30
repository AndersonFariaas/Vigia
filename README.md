# Vigia

Monitor de páginas públicas. Quando o conteúdo muda, o Vigia cria um alerta e envia um e-mail com o que mudou.

Projeto da **Hack Brasil 2026**. Este README explica não só como rodar, mas **por que** cada decisão foi tomada, para servir de material de estudo.

> **Status:** Fase 1 (uso próprio, conta única, sem login). Fases 2 a 5 estão descritas no fim.

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
| `ALERT_EMAIL_TO` | sim | | Destino dos alertas |
| `CHECK_CRON` | não | `*/15 * * * *` | Quando o agendador roda |
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

### 3. Conta única hoje, `user_id` desde já

A Fase 1 tem uma conta só (`ownerId = 1`), mas todas as tabelas de dados e todas as consultas de usuário já filtram por `user_id`. Assim, a Fase 3 (multiusuário) troca só **de onde vem o id**, sem reescrever as consultas. O único método sem filtro é `findByIdUnscoped`, usado pelo agendador e proibido em rotas.

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

### 11. Painel sem `v-html`

Todo texto da página, do alerta ou do erro é exibido por interpolação do Vue, que escapa automaticamente. Os links usam `rel="noopener noreferrer"`.

---

## API

Todas as respostas de erro são JSON, sem stack trace. O corpo é limitado a 10 KB e o `x-powered-by` está desligado.

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/health` | Status da API |
| `GET` | `/api/monitors` | Lista os monitores |
| `POST` | `/api/monitors` | Cadastra (valida URL e SSRF; 409 se duplicado) |
| `POST` | `/api/monitors/:id/check` | Checagem imediata |
| `GET` | `/api/monitors/:id/snapshots` | Últimos snapshots (sem o texto completo) |
| `GET` | `/api/monitors/:id/alerts` | Últimos alertas com o diff |
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
| **Devin** | **Pendente.** Não faz parte da especificação da Fase 1 |
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
- **Sem autenticação na Fase 1:** não exponha na internet. O servidor avisa no console se o `HOST` não for loopback.
- **Sem rate limit na API:** Fase 3.
- **Falha de envio não é reenviada automaticamente:** o alerta fica marcado como `falhou`. Um reenvio manual ou uma fila de retentativa é trabalho da Fase 5.
- **Conta única fixa** (`ownerId = 1`) na Fase 1.
- **Severidade fixa em "média":** a classificação real vem na Fase 2.
- **Normalização agressiva:** qualquer sequência de 16 ou mais caracteres `a-f`/`0-9` é tratada como hash. Por isso um número longo só com dígitos também sai do texto, e uma mudança nele não gera alerta.
- **Sem histórico completo:** são guardados os 50 últimos snapshots por monitor.
- **Retentativa em timeout:** uma checagem que esbarra em timeouts pode levar até ~100 segundos (três tentativas de 30 s, mais as esperas).

---

## Próximas fases

- **Fase 2:** detectores de risco em `src/services/detectors/` (alteração em `<form action>` e campos de senha, novos scripts externos, certificado SSL perto do vencimento, domínios parecidos por distância de edição), classificação de severidade e fixtures de phishing e páginas normais em `tests/fixtures/`, medindo falsos positivos.
- **Fase 3:** autenticação (argon2 ou bcrypt), rate limit, painel completo e multiusuário real.
- **Fase 4:** planos com limites, cobrança (Mercado Pago ou Stripe), termos de uso e LGPD (retenção de 90 dias e exclusão de conta).
- **Fase 5:** logs estruturados, backup, deploy e teste de carga.
