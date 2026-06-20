# Plano Operacional — F2 Deploy & Hardening

> Itens restantes do Roadmap F2. Objetivo: sistema rodando em produção com dados reais.
> Atualizado: 2026-06-19

---

## Visão geral

```
Decisão: provider Evolution API  ←── ABERTO (ver T00)
        │
        ├── T01: RLS (independente)
        ├── T02: Backups Supabase (independente)
        ├── T03: Domínio + DNS
        │       │
        │       ├── T04: Evolution API deploy
        │       │       │
        │       │       ├── T05: Redis deploy
        │       │       │       │
        │       │       │       └── T06: Bot deploy (Railway/Fly)
        │       │       │               │
        │       │       │               └── T07: Webhook Evolution → Bot
        │       │       │
        │       │       └── T10: Conectar WhatsApp real
        │       │
        │       └── T08: Web deploy (Vercel)
        │               └── T09: Sentry env vars + Google OAuth prod URL
        │
        └── T11: Onboarding (Owner + imóveis reais)
```

---

## Decisão pendente: provider da Evolution API

**Antes de T04**, você precisa decidir onde rodar a Evolution API.
Ela precisa de: Docker, URL pública, webhook acessível externamente.

| Opção | Prós | Contras |
|---|---|---|
| **Railway** (recomendado) | Já planejado pro bot, mesmo projeto, Redis addon nativo, HTTPS automático | Free tier tem sleep; plano $5/mês evita isso |
| **Fly.io** | Mais controle, global, bom free tier | Setup mais complexo, Dockerfile customizado |
| **VPS (Hetzner/DigitalOcean)** | Controle total, sem sleep | Precisa gerenciar SSL (Caddy/nginx), mais ops |

**Recomendação:** Railway — tudo no mesmo lugar (Evolution + Redis + Bot), HTTPS automático, $5/mês do Pro plan.

---

## Fase 0 — Independentes (sem pré-requisito de infra)

### T01: Ativar RLS no Supabase

**Descrição:** Executar as policies documentadas em `docs/adrs/001-rls-strategy.md` no banco de produção via SQL Editor do Supabase.

**SQL a executar (Supabase Dashboard → SQL Editor):**

```sql
-- Habilitar RLS nas tabelas
ALTER TABLE "Property" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PropertyMedia" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Lead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ActivityLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RuleSet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContractTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contract" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RuleSetPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PropertyRuleSet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Owner" ENABLE ROW LEVEL SECURITY;

-- Policies SELECT: tabelas com ownerId direto
CREATE POLICY "owner_select" ON "Property"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "owner_select" ON "PropertyMedia"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "owner_select" ON "Lead"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "owner_select" ON "LeadDocument"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "owner_select" ON "Tenant"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "owner_select" ON "Payment"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "owner_select" ON "ActivityLog"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "owner_select" ON "Event"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "owner_select" ON "Conversation"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "owner_select" ON "RuleSet"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "owner_select" ON "ContractTemplate"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "owner_select" ON "Contract"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

-- Policies SELECT: tabelas sem ownerId direto (join)
CREATE POLICY "owner_select" ON "RuleSetPolicy"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "RuleSet" r
      WHERE r.id = "ruleSetId"
      AND auth.uid()::text = r."ownerId"
    )
  );

CREATE POLICY "owner_select" ON "PropertyRuleSet"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "Property" p
      WHERE p.id = "propertyId"
      AND auth.uid()::text = p."ownerId"
    )
  );

-- Owner: só vê a si mesmo
CREATE POLICY "self_select" ON "Owner"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = id);
```

**Critérios de aceite:**

- [ ] Todas as tabelas com RLS habilitado (visível em Supabase → Table Editor → tabela → RLS = enabled)
- [ ] Login no painel exibe dados normalmente (nenhuma query retorna vazio)
- [ ] Abrir DevTools → Network: nenhum erro 403 nas queries Supabase
- [ ] Testar com conta diferente (criar user teste no Supabase Auth) → deve retornar 0 rows

**Verificação:**
```sql
-- Checar quais tabelas têm RLS ativo
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

---

### T02: Confirmar backups Supabase

**Descrição:** Verificar e configurar política de backup automático no Supabase antes de subir dados reais.

**Passos:**
1. Supabase Dashboard → Project Settings → Database → Backups
2. Verificar se "Point in Time Recovery" ou backups diários estão ativos
3. Se no Free Plan: backups automáticos são limitados (1 backup/semana) → considerar upgrade para Pro ($25/mês) ou cron de `pg_dump` manual

**Opção alternativa (Free Plan — backup manual):**
```bash
# Rodar localmente com Direct URL do Supabase
pg_dump "postgresql://postgres:[senha]@[host]:5432/postgres" \
  --format=custom \
  --file="backup-$(date +%Y%m%d).dump"
```

**Critérios de aceite:**
- [ ] Política de backup documentada (qual frequência, onde fica)
- [ ] Pelo menos um backup manual feito e verificado antes de onboarding

---

## Fase 1 — Infra (executar em ordem)

### T03: Domínio + DNS

**Descrição:** Registrar/apontar domínio para os serviços.

**Decisões:**
- Domínio principal (ex: `kit-manager.com.br` ou `seudominio.com.br`)
- Subdomínios sugeridos:
  - `app.seudominio.com.br` → Vercel (painel web)
  - `bot.seudominio.com.br` → Railway (bot Fastify)
  - `evo.seudominio.com.br` → Railway (Evolution API)

**Passos:**
1. Registrar domínio (Registro.br para `.com.br`, Namecheap/GoDaddy para `.com`)
2. Apontar nameservers para Cloudflare (recomendado: DDoS protection, SSL automático, gestão central de DNS)
3. Criar registros CNAME após deploy de cada serviço (os providers geram a URL — você cria o CNAME na sequência)

**Critérios de aceite:**
- [ ] Domínio registrado e propagado
- [ ] Cloudflare configurado como DNS manager (opcional mas recomendado)
- [ ] Subdomínios planejados documentados aqui

---

### T04: Evolution API deploy

**Descrição:** Deploy da Evolution API em container Docker com URL pública para receber webhooks do WhatsApp.

**Se Railway:**
```
Railway → New Project → Deploy from Docker image
Image: atendai/evolution-api:latest
Porta: 8080
```

**Variáveis de ambiente necessárias (Evolution API):**
```env
AUTHENTICATION_API_KEY=<gerar string aleatória>
SERVER_URL=https://evo.seudominio.com.br
WEBHOOK_GLOBAL_ENABLED=false
DATABASE_ENABLED=false
REDIS_ENABLED=false
# (Evolution usa storage próprio por padrão)
```

**Passos:**
1. Deploy no provider escolhido
2. Apontar CNAME `evo.seudominio.com.br` → URL gerada pelo provider
3. Verificar painel Evolution: `https://evo.seudominio.com.br` → deve exibir a UI
4. Criar instância WhatsApp no painel Evolution (não conectar ainda — isso é T10)
5. Copiar: URL base, nome da instância, API key → vai preencher env do bot (T06)

**Critérios de aceite:**
- [ ] `GET https://evo.seudominio.com.br` retorna 200 ou UI da Evolution
- [ ] Instância criada e visível no painel (status: `disconnected` — normal por ora)
- [ ] `EVOLUTION_API_URL`, `EVOLUTION_INSTANCE_NAME`, `EVOLUTION_API_KEY` anotados

---

### T05: Redis deploy

**Descrição:** Provisionar Redis acessível pelo bot em produção.

**Se Railway:**
```
Railway → seu projeto → Add Service → Database → Redis
```
Copia a `REDIS_URL` gerada (formato `redis://default:senha@host:port`).

**Se Upstash (alternativa serverless, free tier generoso):**
- Criar conta em upstash.com → Create Database → Redis
- Copiar `UPSTASH_REDIS_REST_URL` (atenção: formato diferente, verificar compatibilidade com `ioredis`)

**Nota:** O bot usa `ioredis` com URL direta. Upstash requer o `@upstash/redis` SDK para REST API. Se usar Upstash, verificar se a URL TCP funciona (plano pago) ou trocar para Railway Redis.

**Critérios de aceite:**
- [ ] Redis acessível externamente
- [ ] `REDIS_URL` anotada para usar no bot (T06)
- [ ] Testar conexão: `redis-cli -u $REDIS_URL ping` → `PONG`

---

### T06: Bot deploy (Railway ou Fly)

**Descrição:** Deploy do `apps/bot` como serviço Node.js/Bun em produção.

**Se Railway:**
```
Railway → New Service → GitHub repo
Root Directory: apps/bot
Build Command: bun install && bun run build (ou deixar Railway detectar)
Start Command: bun run start
```

**Variáveis de ambiente (todas obrigatórias — ver docs/deploy.md):**
```env
OPENAI_API_KEY=
OPENAI_MODEL_NAME=gpt-4o-mini
EVOLUTION_API_URL=https://evo.seudominio.com.br
EVOLUTION_INSTANCE_NAME=<nome criado no T04>
EVOLUTION_API_KEY=<key do T04>
DATABASE_URL=<Supabase pooler — Transaction mode>
DIRECT_URL=<Supabase direct — Session mode>
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
REDIS_URL=<do T05>
PORT=3000
DEBOUNCE_SECONDS=5
BUFFER_TTL_SECONDS=3600
LOG_LEVEL=info
GOOGLE_CREDENTIALS_JSON=<conteúdo do JSON completo como string>
```

**Checklist pós-deploy:**
1. Ver logs: `bun run start` deve mostrar `Fastify server running on port 3000`
2. `GET https://bot.seudominio.com.br/health` → 200 (se existir endpoint de healthcheck)
3. Verificar logs Pino: JSON estruturado, sem erros de conexão ao banco ou Redis

**Critérios de aceite:**
- [ ] Bot rodando sem erros nos logs
- [ ] `DATABASE_URL` conecta ao Supabase (sem erro de pool)
- [ ] Redis conectado (sem erro `ECONNREFUSED`)
- [ ] CNAME `bot.seudominio.com.br` aponta para o serviço

---

### T07: Configurar webhook Evolution → Bot

**Descrição:** Apontar o webhook da Evolution API para o endpoint do bot em produção.

**Passos:**
1. Painel Evolution (`https://evo.seudominio.com.br`) → sua instância → Webhook
2. Configurar:
   ```
   Webhook URL: https://bot.seudominio.com.br/webhook
   Events: messages.upsert (apenas este)
   ```
3. Salvar e verificar que a instância recebe o webhook configurado

**Critérios de aceite:**
- [ ] Webhook configurado e salvo na Evolution
- [ ] Logs do bot mostram requests chegando em `/webhook` quando mensagem é enviada (teste com número de teste antes de conectar o número real)

---

## Fase 2 — Web deploy

### T08: Web deploy (Vercel)

**Descrição:** Deploy do `apps/web` no Vercel.

**Passos:**
1. vercel.com → Import Git Repository → selecionar `kit-manager`
2. Framework: Vite
3. Root Directory: `apps/web`
4. Build Command: `bun run build`
5. Output Directory: `dist`

**Variáveis de ambiente no Vercel:**
```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_BOT_API_URL=https://bot.seudominio.com.br
VITE_SENTRY_DSN=<do sentry.io>
SENTRY_AUTH_TOKEN=<do sentry.io>
SENTRY_ORG=<slug da org>
SENTRY_PROJECT=<nome do projeto>
```

**Critérios de aceite:**
- [ ] Build Vercel green
- [ ] `https://app.seudominio.com.br` carrega o painel (tela de login)
- [ ] Login com Google OAuth funciona
- [ ] Dashboard carrega dados reais do banco

---

### T09: Sentry env vars + Google OAuth URL produção

**Descrição:** Completar configurações que dependem do domínio final de produção.

**Sentry (itens pendentes do deploy.md):**
- [ ] `VITE_SENTRY_DSN` → sentry.io → Project → Settings → Client Keys
- [ ] `SENTRY_AUTH_TOKEN` → sentry.io → Settings → Auth Tokens → escopo `project:releases`
- [ ] `SENTRY_ORG` e `SENTRY_PROJECT` → setar no Vercel
- [ ] Após próximo deploy: verificar em sentry.io que source maps foram enviados

**Google OAuth redirect URL:**
- [ ] Supabase → Authentication → URL Configuration → adicionar: `https://app.seudominio.com.br/**`
- [ ] Google Cloud Console → OAuth 2.0 Client → Authorized redirect URIs → adicionar URL do Supabase Auth callback

**Critérios de aceite:**
- [ ] Login via Google funciona em produção
- [ ] Sentry.io recebe erros de produção com stack trace legível (não minificado)

---

## Fase 3 — Conexão e onboarding

### T10: Conectar bot ao WhatsApp real

**Descrição:** Associar número de WhatsApp real à instância Evolution API.

**Pré-requisito:** T04 (Evolution deploy) + T06 (Bot deploy) + T07 (webhook configurado).

**Passos:**
1. Painel Evolution → sua instância → Connect
2. Escanear QR code com o número de WhatsApp real do proprietário (ou número dedicado ao bot)
3. Aguardar status: `open` (conectado)
4. Verificar: enviar mensagem para o número → bot deve responder

**Critérios de aceite:**
- [ ] Status da instância Evolution: `open`
- [ ] Mensagem de teste recebida e respondida pelo bot
- [ ] Logs do bot mostram processamento da mensagem (extrator, router, agente)
- [ ] Sem erros 500 ou timeouts nos logs

---

### T11: Onboarding — cadastrar Owner + imóveis reais

**Descrição:** Cadastrar o proprietário como `Owner` no banco e importar imóveis existentes.

**Passos:**

**1. Criar Owner:**
```sql
-- No Supabase SQL Editor, após fazer login no painel e obter o auth.uid():
-- Substitua <seu-auth-uid> pelo UUID do seu usuário Supabase Auth
INSERT INTO "Owner" (id, name, email, "notificationPhone", "notificationEmail")
VALUES (
  '<seu-auth-uid>',
  'Seu Nome',
  'fred.rlopes@gmail.com',
  '+55119XXXXXXXX',   -- seu número WhatsApp pessoal (recebe notif do bot)
  'fred.rlopes@gmail.com'
);
```

**2. Para cada imóvel real, via painel web (`/properties/new`) ou via API:**
```
POST https://bot.seudominio.com.br/admin/properties
Authorization: Bearer <JWT do Supabase>
{
  "name": "Nome do imóvel",
  "address": "Rua X, 123",
  "neighborhood": "Bairro",
  "city": "São Paulo",
  "state": "SP",
  "rentAmount": 1500,
  "depositAmount": 3000,
  "bedrooms": 2,
  "bathrooms": 1,
  "area": 55,
  "status": "available"
}
```

**3. Verificar:**
- Painel `/properties` exibe imóveis com externalId (IM-0001, IM-0002...)
- Status correto em cada imóvel (available / rented / maintenance)

**Critérios de aceite:**
- [ ] Owner cadastrado com `id = auth.uid()` do Supabase Auth
- [ ] Todos os imóveis reais cadastrados com status correto
- [ ] Bot consegue listar imóveis disponíveis (teste: enviar mensagem ao bot pedindo opções)
- [ ] Painel mostra imóveis reais no Dashboard e em `/properties`

---

## Checkpoint Final

- [ ] T01: RLS ativo e testado
- [ ] T02: Backup confirmado/agendado
- [ ] T03: Domínio + DNS propagado
- [ ] T04: Evolution API respondendo em produção
- [ ] T05: Redis disponível e conectado ao bot
- [ ] T06: Bot rodando em produção sem erros
- [ ] T07: Webhook Evolution → Bot configurado
- [ ] T08: Painel web em produção (Vercel)
- [ ] T09: Sentry + Google OAuth com URL de produção
- [ ] T10: WhatsApp real conectado e respondendo
- [ ] T11: Owner + imóveis reais cadastrados

**Após checkpoint:** Fase 3 — Dogfooding (uso próprio real).

---

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Evolution API perde conexão WhatsApp | Alto | Configurar reconnect automático; monitorar status via painel |
| `SUPABASE_SERVICE_KEY` exposta | Crítico | Nunca logar; usar secrets do Railway/Fly, não variáveis de build |
| RLS bloqueia queries do painel após ativação | Médio | Testar em branch de staging antes de prod; rollback fácil (`ALTER TABLE ... DISABLE ROW LEVEL SECURITY`) |
| Railway free tier colocando bot em sleep | Alto | Upgradar para Railway Pro ($5/mês) ou usar Fly.io com `min_machines_running = 1` |
| Redis sem persistência (dados de buffer perdidos no restart) | Baixo | Buffer é temporário (max 1h TTL); perda aceitável; configurar Redis com AOF se quiser persistência |

---

## Decisões em aberto

1. **Provider Evolution API** — Railway vs Fly vs VPS (ver análise no início do doc)
2. **Domínio** — qual domínio usar? `.com.br` ou `.com`?
3. **Plano Supabase** — Free (backup limitado) ou Pro ($25/mês, backup diário)?
4. **Número WhatsApp do bot** — número dedicado (chip novo) ou número pessoal?
