# Contabia

Plataforma de faturação, contabilidade SNC e SAF-T para empresas em Portugal, com o assistente virtual Luís.
Duas apps móveis (iOS e Android) e um servidor partilhado:

| Pasta | O que é |
| --- | --- |
| `apps/empresa` | App da empresa (Expo / React Native): painel, digitalização por código QR, documentos, Luís, prazos, ligação ao contabilista, atualizações fiscais |
| `apps/contabilista` | App do Contabilista Certificado (telemóvel e tablet): carteira, ligar empresa, revisão de lançamentos, IVA, pedidos, SAF-T, fecho de período |
| `apps/server` | API + tempo real (Fastify, PostgreSQL, WebSocket) |
| `packages/shared` | Regras de negócio partilhadas: NIF, código QR da AT, taxas de IVA por região, calendário fiscal, cliente da API |
| `packages/ui` | Tema, logótipo, Luís, componentes e sessão partilhados pelas duas apps |
| `testes/` | Teste de ponta a ponta no navegador (Playwright) |

## Experimentar já (online)

- **App da empresa** (abra no telemóvel): https://contabia.onrender.com/empresa/
- **App do Contabilista Certificado**: https://contabia.onrender.com/contabilista/

Plano gratuito do Render: o servidor adormece após 15 minutos sem uso (o primeiro acesso demora cerca de 1 minuto). Os dados ficam numa base de dados PostgreSQL (`contabia-db`) e já não se perdem quando o serviço reinicia ou é atualizado. A base de dados gratuita do Render expira 30 dias após ser criada; antes disso, passe-a para um plano pago (Basic) no painel do Render.

### Antes do primeiro cliente real: dados na UE (RGPD)

Na fase de testes (só dados fictícios) o servidor fica em Oregon (EUA). Antes de qualquer cliente real:
1. No GitHub, apague `render.yaml` e mude o nome de `render.eu.yaml` para `render.yaml`.
2. No Render, crie um Blueprint novo a partir do repositório (servidor `contabia-eu` e base de dados `contabia-db-eu`, em Frankfurt).
3. Preencha `BREVO_API_KEY` e `EMAIL_REMETENTE`, confirme que funciona e apague os serviços antigos de Oregon.

O Render não permite mudar a região de um serviço já criado; por isso é uma migração e não uma definição.

### Avisos no telemóvel

- **Avisos de prazos locais** (7 dias, 2 dias e no próprio dia, às 9h): funcionam já, mesmo com a app fechada e sem internet.
- **Avisos enviados pelo servidor** (pedidos do contabilista, convites, anulações, prazos): ficam ativos quando a app for publicada com EAS Build (`npx eas init` cria o ID do projeto, que vai para `extra.eas.projectId` no `app.json`). O Expo Go no Android não recebe este tipo de aviso.
- **Plano gratuito do Render**: o servidor adormece. Para os avisos de prazos saírem todos os dias, crie em cron-job.org um pedido diário às 9h00 (Lisboa) para `POST https://contabia.onrender.com/v1/admin/avisos-prazos` com o cabeçalho `x-admin-token` igual ao `ADMIN_TOKEN` do Render.

### Ligação empresa ⇄ contabilista (dois sentidos)

- **O contabilista pede**: em «Ligar empresa» escreve o utilizador e o NIF da empresa; a empresa aceita com biometria.
- **A empresa convida**: em «Ligação ao contabilista» escreve o e-mail ou o n.º OCC do contabilista; ele aceita em «Convites recebidos».
- Se os dois se convidarem ao mesmo tempo, a ligação fica ativa logo. Quem enviou pode cancelar; quem recebeu aceita ou recusa. Qualquer lado pode terminar a ligação, e o acesso é cortado no mesmo instante.

## Começar em 5 minutos

Requisitos: Node.js 20 ou mais recente, e a app **Expo Go** no telemóvel.

```bash
npm install
npm run server          # API em http://localhost:3000 (base de dados local PGlite em ./data)
```

Noutro terminal, com o endereço do computador na rede local:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.10:3000 npm run empresa        # leia o QR com o Expo Go
EXPO_PUBLIC_API_URL=http://192.168.1.10:3000 npm run contabilista
```

Experimente o fluxo completo:

1. Na app da empresa, **Criar conta** (utilizador, NIF válido, região, regime de IVA).
2. Na app do contabilista, **Criar conta** e **Ligar empresa** com o mesmo utilizador e NIF.
3. A empresa recebe o pedido em tempo real e **aceita com biometria**.
4. A empresa digitaliza uma fatura (código QR) ou introdu-la à mão e **valida**.
5. O contabilista **aprova** o lançamento, **gera o ficheiro de IVA**, regista o comprovativo, faz **pedidos**, gera o **SAF-T** e **fecha o período**.

## Testes

```bash
npm test             # testes de regras partilhadas + 10 testes de ponta a ponta da API
npm run typecheck    # tipos de todos os pacotes
```

Teste no navegador (as duas apps contra o servidor real):

```bash
npm run server
(cd apps/empresa && npx expo export -p web --output-dir /tmp/web-empresa) && (cd /tmp/web-empresa && python3 -m http.server 8081 &)
(cd apps/contabilista && npx expo export -p web --output-dir /tmp/web-cc) && (cd /tmp/web-cc && python3 -m http.server 8082 &)
pip install playwright && playwright install chromium
python3 testes/navegador_e2e.py
```

## Produção

```bash
cp .env.example .env    # preencha JWT_SECRET, POSTGRES_PASSWORD, ADMIN_TOKEN
docker compose up -d    # PostgreSQL + API na porta 3000
```

| Variável | Para quê |
| --- | --- |
| `DATABASE_URL` | PostgreSQL. Sem ela, usa PGlite local (só desenvolvimento) |
| `JWT_SECRET` | Assinatura das sessões (obrigatória em produção) |
| `ADMIN_TOKEN` | Publicar novas regras fiscais em `POST /v1/admin/regras` |
| `ANTHROPIC_API_KEY` | Opcional: o Luís responde com IA; sem chave, usa regras locais |
| `EXPO_PUBLIC_API_URL` | Endereço da API usado pelas apps |

Builds para as lojas: `npx eas build -p ios` / `-p android` em cada app (precisa de conta Expo, Apple Developer e Google Play).

## Como funciona

- **Ligação em duas vias**: o contabilista pede com *utilizador + NIF* (validados e coincidentes); a empresa aceita na app com biometria; pedidos expiram em 72 h; qualquer lado pode revogar.
- **Sem falhas de ligação**: cada alteração é um evento numerado; as apps recebem-no por WebSocket e, ao reconectar, pedem o que falta pelo cursor; escritas com chave de idempotência e reenvio automático; concorrência otimista por versão.
- **Regras fiscais automáticas**: taxas, prazos e prorrogações são dados versionados; uma nova versão publicada chega a todas as apps e aplica-se na data legal, sem atualizar a app.
- **Contabilidade**: a IA sugere a conta SNC (histórico do fornecedor + palavras-chave), propõe o lançamento em partidas dobradas, e só o contabilista lança. Apuramento de IVA por campos da declaração periódica (Continente, Madeira, Açores). Estornos em vez de alterações. Períodos fechados ficam bloqueados.

## Antes de entrar em produção (não se resolve só com código)

- [ ] **Certificação da AT** do módulo de faturação (Portaria n.º 363/2010): a emissão de faturas certificadas (assinatura/hash, ATCUD) ainda não está incluída — as apps registam faturas recebidas e emitidas por outros programas.
- [ ] **Webservices da AT** (comunicação de faturas, séries ATCUD): exigem credenciais e certificado da empresa produtora.
- [ ] **Formato oficial da declaração periódica**: o ficheiro gerado (`xmlDP`) usa uma estrutura interna; mapear para o formato de importação do Portal das Finanças.
- [ ] **Taxonomias SNC** (`TAXONOMIAS` em `apps/server/src/contabilidade.ts`): preencher e validar com um Contabilista Certificado; validar o SAF-T no validador oficial da AT.
- [ ] Guardar imagens/PDF dos documentos (armazenamento de objetos na UE), recuperação de senha, notificações push (APNs/FCM).
- [ ] Revisão jurídica (RGPD, termos) e testes de intrusão.
