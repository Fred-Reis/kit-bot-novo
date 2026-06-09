# SECURITY.md — kit-manager

> Auditoria de segurança realizada em 2026-06-09.
> Escopo: `apps/bot` (Fastify/Prisma/OpenAI/Evolution API) + `apps/web` (React/Supabase Auth).

---

## Resumo executivo

| Severidade | Qtd |
|---|---|
| 🔴 Critical | 2 |
| 🟠 High | 5 |
| 🟡 Medium | 6 |
| 🔵 Low | 4 |
| ℹ️ Info | 3 |

**Bloqueadores antes de qualquer tráfego real:**
1. Rotacionar todos os secrets (OpenAI, Supabase service key, DB password, Google SA)
2. Adicionar autenticação no webhook da Evolution API
3. Ativar RLS no Supabase antes de ir para produção

---

## 🔴 Critical

### C1 — Secrets reais em arquivos `.env` no disco

**Local:** `apps/bot/.env`, `apps/web/.env`

Os arquivos `.env` contêm credenciais reais em plaintext: OpenAI API key, Supabase service role key (bypassa toda RLS), chave privada RSA da service account Google Cloud, e string de conexão PostgreSQL com senha (`SenhaNova123`).

**Impacto:** Qualquer pessoa com acesso ao disco ou a um artefato de CI onde esses arquivos escapassem teria acesso completo ao banco, Storage, OpenAI e Google Cloud OCR.

**Verificar:** `git log --all --full-history -- "**/.env"` — confirmar que nunca foram commitados. Se sim, rotacionar novamente.

**Ação:**
- Rotacionar imediatamente: OpenAI key, Supabase service key, senha do banco, Google service account
- Nunca commitar `.env` real — apenas `.env.example` com valores placeholder
- Em CI/CD: usar variáveis de ambiente do provedor (Vercel env vars, Railway secrets, GitHub Actions secrets)

---

### C2 — Webhook da Evolution API sem autenticação

**Local:** `apps/bot/src/webhooks/evolution.ts:93-112`

O endpoint `POST /webhook` aceita qualquer requisição HTTP sem verificação de assinatura, API key ou IP allowlist. Qualquer pessoa que conheça a URL pode injetar payloads forjando qualquer número de WhatsApp.

**Impacto:** Criação e manipulação de leads com números arbitrários, upload de arquivos maliciosos para o Storage, transições de estado indevidas (KYC, contratos), esgotamento de quota OpenAI.

**Prova de conceito:**
```bash
curl -X POST http://bot.example.com/webhook \
  -H "Content-Type: application/json" \
  -d '{"event":"messages.upsert","data":{"key":{"remoteJid":"5511999999999@s.whatsapp.net","id":"FAKE01"},"pushName":"Attacker","message":{"conversation":"vi o anuncio"}}}'
```

**Ação:**
```typescript
// apps/bot/src/webhooks/evolution.ts
const secret = request.headers['x-webhook-secret'];
if (secret !== config.WEBHOOK_SECRET) {
  return reply.status(401).send({ error: 'Unauthorized' });
}
```
Adicionar `WEBHOOK_SECRET` no env e configurar a Evolution API para enviar o header em todos os webhooks.

---

## 🟠 High

### H1 — Nenhuma verificação de ownership nos endpoints admin

**Local:** `apps/bot/src/routes/admin.ts` (todos os endpoints)

`verifyAdminJwt` valida o JWT Supabase, mas `adminUserId` é usado apenas para o activity log. O `ownerId` para queries é resolvido via `prisma.owner.findFirst()` — completamente desacoplado do usuário autenticado. Qualquer sessão Supabase válida consegue operar sobre todos os dados.

**Ação:** Após verificar o JWT, resolver o `Owner` pelo `userId` autenticado e usar esse `owner.id` em todos os `where` clauses:
```typescript
const owner = await prisma.owner.findUnique({ where: { userId: request.adminUserId } });
if (!owner) return reply.status(403).send({ error: 'Forbidden' });
```

---

### H2 — axios com múltiplos CVEs críticos

**Local:** `apps/web/package.json` — `"axios": "^1.15.0"`

9 CVEs High reportados pelo `bun audit` incluindo prototype pollution (GHSA-q8qp-cvcw-x6jj), credential leak via proxy redirect (GHSA-p92q-9vqr-4j8f), e response tampering. O `botApi` usa axios para todas as mutações, transmitindo JWTs Supabase.

**Ação:** `bun add axios@latest` em `apps/web`. Considerar substituir por `fetch` nativo — o módulo `api.ts` é pequeno e não precisa de axios.

---

### H3 — `fast-uri` com path traversal (dependência transitiva do Fastify)

**Local:** `apps/bot` — Fastify depende de `fast-uri <=3.1.1`

CVEs GHSA-v39h-62p7-jpjc (path traversal via dot segments) e GHSA-q3j6-qgpj-74h6 (host confusion). Afeta endpoints que usam path params como base para caminhos no Storage.

**Ação:** `bun update fastify` em `apps/bot` para obter `fast-uri` corrigido.

---

### H4 — SQL injection latente via `$queryRawUnsafe`

**Local:** `apps/bot/src/services/external-id.ts:26`

```typescript
prisma.$queryRawUnsafe(`SELECT nextval('${seq}')`)
```

O `seq` vem de um mapa tipado em TypeScript, sem validação em runtime. Padrão perigoso que pode escalar para injeção se o código evoluir.

**Ação:**
```typescript
import { sql } from '@prisma/client';
const rows = await prisma.$queryRaw<{ nextval: bigint }[]>`SELECT nextval(${seq}::regclass)`;
```

---

### H5 — Upload de documentos de lead sem validação de MIME type

**Local:** `apps/bot/src/services/storage.ts:6-29`

`uploadLeadDocument` aceita qualquer `mimeType` do payload do webhook sem verificação. Combinado com C2 (webhook sem auth), permite upload de arquivos arbitrários para o bucket `leads`.

**Ação:**
```typescript
const ALLOWED_LEAD_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf',
]);
if (!ALLOWED_LEAD_MIME_TYPES.has(mimeType)) {
  throw new Error(`Unsupported MIME type: ${mimeType}`);
}
```

---

## 🟡 Medium

### M1 — `paymentDayOfMonth` sem validação de range

**Local:** `apps/bot/src/routes/admin.ts:227-269`

O valor é interpolado diretamente em mensagem WhatsApp para o lead sem verificar se está no intervalo 1–28. Sem validação de runtime (TypeScript não protege em runtime).

**Ação:**
```typescript
if (!Number.isInteger(paymentDayOfMonth) || paymentDayOfMonth < 1 || paymentDayOfMonth > 28) {
  return reply.status(400).send({ error: 'paymentDayOfMonth must be between 1 and 28' });
}
```

---

### M2 — `innerHTML` sem sanitização no editor de templates

**Local:** `apps/web/src/routes/_dashboard/templates/index.tsx:121`

`editorRef.current.innerHTML = getEditorHtml(body)` — uso de `innerHTML` em área `contenteditable`. O `escapeHtml()` cobre os casos normais, mas a superfície é frágil. XSS stored no painel admin (impacto limitado ao owner).

**Ação:** Adicionar `DOMPurify.sanitize()` antes de atribuir ao `innerHTML`, ou migrar para TipTap/ProseMirror.

---

### M3 — Sem rate limiting em nenhum endpoint

**Local:** `apps/bot/src/app.ts` — sem plugin de rate limit registrado

Webhook sem limite pode esgotar quota OpenAI. Endpoints admin sem limite permitem transições de estado duplicadas (approve-kyc, confirm-payment) e flood de mensagens WhatsApp.

**Ação:** Instalar `@fastify/rate-limit`:
```typescript
await fastify.register(import('@fastify/rate-limit'), { global: false });
// Webhook — por IP
fastify.post('/webhook', { config: { rateLimit: { max: 100, timeWindow: '1 minute' } } }, ...);
```

---

### M4 — `ADMIN_ORIGIN` fora do schema Zod

**Local:** `apps/bot/src/app.ts:15`

`process.env.ADMIN_ORIGIN` lido diretamente, sem passar pela validação do `config.ts`. Se não configurado em produção, CORS bloqueia o admin silenciosamente.

**Ação:** Adicionar ao schema Zod em `config.ts`:
```typescript
ADMIN_ORIGIN: z.string().url().refine(v => v !== '*', 'Wildcard CORS não permitido').default('http://localhost:5173'),
```

---

### M5 — `ssl: { rejectUnauthorized: false }` na conexão PostgreSQL

**Local:** `apps/bot/src/db/client.ts:10`

Desativa verificação de certificado TLS na conexão com o banco. Permite MitM na camada de transporte expondo PII dos leads (CPF, renda, telefone, documentos).

**Ação:** Usar o certificado CA do Supabase e `rejectUnauthorized: true`. Separar config de SSL entre dev (self-signed) e prod (CA válida).

---

### M6 — RLS desativada no Supabase

**Local:** `apps/web/src/lib/queries.ts` (todas as queries), `apps/web/src/lib/supabase.ts`

Com RLS desabilitada, a anon key (exposta no bundle do frontend) pode ler todas as tabelas: leads com telefone e CPF, documentos, contratos, pagamentos, conversas.

**Ação:** Habilitar RLS antes de ir para produção. Policy mínima para single-owner:
```sql
CREATE POLICY "owner_only" ON "Lead"
  FOR ALL USING (
    owner_id = (SELECT id FROM "Owner" WHERE user_id = auth.uid())
  );
```
Aplicar em todas as tabelas: Lead, Tenant, Property, Payment, Contract, ActivityLog, LeadDocument, Conversation.

---

## 🔵 Low

### L1 — Security headers ausentes no Fastify

**Local:** `apps/bot/src/app.ts`

Sem `@fastify/helmet` — ausência de `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`.

**Ação:** `bun add @fastify/helmet` → `await fastify.register(helmet)`.

---

### L2 — Security headers ausentes no SPA

**Local:** `apps/web/index.html`, sem `vercel.json`

Sem CSP, sem `X-Frame-Options`. Google Fonts carregados sem `integrity` hash.

**Ação:** Criar `apps/web/vercel.json`:
```json
{
  "headers": [{
    "source": "/(.*)",
    "headers": [
      { "key": "X-Frame-Options", "value": "DENY" },
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
    ]
  }]
}
```

---

### L3 — `ownerPhoneCache` em memória sem eviction

**Local:** `apps/bot/src/services/notify.ts:28`

Cache do telefone do owner é um `Map` de módulo sem TTL. Se o número mudar no banco, as notificações vão para o número antigo até o processo reiniciar.

**Ação:** Remover o cache (a query é uma única linha indexada, overhead negligível).

---

### L4 — Dependência LangSmith com CVEs de SSRF e prompt injection

**Local:** `apps/bot/package.json` — `@langchain/core` puxa `langsmith` transitivamente

GHSA-3644-q5cj-c5c7 (deserialização de manifestos não confiáveis) e GHSA-v34v-rq6j-cj6p (SSRF via tracing header). LangSmith tracing não está configurado mas a dependência está presente.

**Ação:** `bun update @langchain/core langchain` para versões que puxam `langsmith >= 0.4.6`. Garantir `LANGCHAIN_TRACING_V2=false` em produção.

---

## ℹ️ Info

### I1 — Sem body size limit explícito no Fastify

O default é 1 MiB. Webhook recebe base64 de imagens que podem ser maiores. Configurar `bodyLimit` explícito por rota.

### I2 — `document.execCommand('insertText', ...)` deprecated

**Local:** `apps/web/src/routes/_dashboard/templates/index.tsx:148`

Funciona hoje mas será removido em browsers futuros. Migrar para Selection/Range API ou editor de rich text.

### I3 — Magic link `emailRedirectTo` usa `window.location.origin`

Correto tecnicamente. Confirmar que as configurações do projeto Supabase têm allowlist de redirect URLs configurada para produção + localhost apenas.

---

## Boas práticas já em vigor

- **Validação Zod no boot** — env vars inválidas crasham o processo imediatamente com mensagem clara
- **Transições de estado atômicas** — `updateMany({ where: { id, stage: 'expected' } })` evita race conditions e double-processing
- **Prisma ORM em todo acesso de dados** — queries parametrizadas por padrão, exceto o `$queryRawUnsafe` em `external-id.ts` (apontado em H4)
- **MIME type allowlist em uploads de imóveis** — `ALLOWED_MEDIA_TYPES` em `admin.ts`
- **Redação de payloads nos logs** — `redactPayload()` remove base64 e conteúdo sensível dos logs
- **Deduplicação de mensagens** — Redis com semântica `NX` evita duplo-processamento de webhooks
- **JWT verificado via Supabase** — `supabaseAdmin.auth.getUser(token)` delega para a fonte de verdade, sem verificação manual de assinatura
- **Soft delete para imóveis** — preserva integridade referencial
- **Comportamentos determinísticos isolados do LLM** — ações de segurança nunca passam pelo modelo
- **`.env` no `.gitignore`** — `.env.example` com placeholders corretos

---

## Roadmap de remediação (priorizado)

### Imediato (antes de qualquer tráfego real)
- [ ] Rotacionar todos os secrets (OpenAI, Supabase service key, DB password, Google SA key)
- [ ] Adicionar autenticação no webhook Evolution API (`x-webhook-secret`)
- [ ] Ativar RLS em todas as tabelas Supabase

### Antes do go-live
- [ ] `bun add axios@latest` em `apps/web` (ou substituir por `fetch`)
- [ ] `bun update fastify` em `apps/bot` (fix `fast-uri` CVEs)
- [ ] Substituir `$queryRawUnsafe` por template literal do Prisma
- [ ] Instalar `@fastify/rate-limit` no bot
- [ ] Adicionar MIME type validation em `uploadLeadDocument`
- [ ] Adicionar validação de range em `paymentDayOfMonth`
- [ ] Corrigir `ssl: { rejectUnauthorized: false }` no cliente PostgreSQL

### Próxima sprint
- [ ] Adicionar `@fastify/helmet` no bot
- [ ] Criar `vercel.json` com security headers no web
- [ ] Adicionar `ADMIN_ORIGIN` ao schema Zod
- [ ] Remover cache sem eviction em `notify.ts`
- [ ] Vincular `adminUserId` ao `ownerId` nas queries (ownership check)
- [ ] `bun update @langchain/core` para fixar LangSmith CVEs
