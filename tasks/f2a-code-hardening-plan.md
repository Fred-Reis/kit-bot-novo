# Plan — f2a: Code Hardening

> Spec: specs/f2a-code-hardening.md
> Pipeline: spec ✅ → **plan ✅** → build → simplify → review → COMMIT

---

## Dependências entre tarefas

```
T1 (MSW dynamic import)     ──── independente
T2 (Pino install + logger)  ──── independente
T3 (Pino migrate console.*) ──── depende de T2
T4 (Sentry install + init)  ──── independente
T5 (Sentry error boundary)  ──── depende de T4
T6 (ADR 001 RLS)            ──── independente
T7 (docs/deploy.md)         ──── independente
```

Ordem recomendada: T1 → T2 → T3 → T4 → T5 → T6 → T7

T1, T2, T4, T6, T7 podem ser feitos em paralelo (nenhuma dependência entre si).
T3 requer T2 concluído. T5 requer T4 concluído.

---

## Tarefas

### T1 — MSW: dynamic import em main.tsx

**Arquivo:** `apps/web/src/main.tsx`

**Problema atual:**
```ts
import { worker } from './mocks/browser';   // ← import estático: MSW entra no bundle de prod
if (import.meta.env.DEV) {
  await worker.start({ onUnhandledRequest: 'bypass' });
}
```

**Fix:**
```ts
if (import.meta.env.DEV) {
  const { worker } = await import('./mocks/browser');  // ← dynamic: tree-shaken em prod
  await worker.start({ onUnhandledRequest: 'bypass' });
}
```

**Verificação:**
- [ ] `cd apps/web && bun run build` completa sem erro
- [ ] `grep -r "setupWorker\|msw" dist/assets/*.js` retorna vazio
- [ ] `bun run dev` → MSW intercepta requisições normalmente (ver console do browser)

---

### T2 — Pino: instalar e criar logger.ts

**Comandos:**
```bash
cd apps/bot && bun add pino
```

**Criar `apps/bot/src/lib/logger.ts`:**
```ts
import pino from 'pino';
export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
```

**Criar `apps/bot/src/lib/` se não existir** (provavelmente não existe).

**Verificação:**
- [ ] `bunx tsc --noEmit` em `apps/bot` sem erros
- [ ] `logger.info('test')` emite JSON com campos `level`, `time`, `msg`

---

### T3 — Pino: migrar todos os console.* no bot

**21 ocorrências em 7 arquivos.** Para cada arquivo, importar `logger` e substituir:
- `console.log(...)` → `logger.info(...)`
- `console.info(...)` → `logger.info(...)`
- `console.warn(...)` → `logger.warn(...)`
- `console.error(...)` → `logger.error(...)`

**Arquivos e ocorrências:**

| Arquivo | Calls | Tipos |
|---|---|---|
| `src/buffer.ts` | 4 | warn×2, error×1, info×1 |
| `src/agents/lead.ts` | 3 | error×3 |
| `src/flows/router.ts` | 3 | error×2, log×1 |
| `src/flows/tenant/index.ts` | 1 | info×1 |
| `src/flows/lead/index.ts` | 6 | info×2, error×4 |
| `src/services/ocr.ts` | 3 | warn×3 |
| `src/services/notify.ts` | 2 | error×2 |

**Nota de assinatura Pino:**
- `logger.info('mensagem')` → ok
- `logger.error(err, 'mensagem')` → Pino serializa `err` com `err.message` + `err.stack`
- `logger.warn({ chatId }, 'mensagem')` → objeto de contexto como primeiro arg

**Verificação:**
- [ ] `grep -rn "console\." apps/bot/src --include="*.ts"` retorna vazio
- [ ] `bunx tsc --noEmit` em `apps/bot` sem erros
- [ ] `bun run dev` no bot: output JSON no terminal

---

### T4 — Sentry: instalar e inicializar no web

**Comando:**
```bash
cd apps/web && bun add @sentry/react
```

**Modificar `apps/web/src/main.tsx`** — adicionar antes de `createRoot`:
```ts
import * as Sentry from '@sentry/react';

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
  });
}
```

**Variável nova:** adicionar `VITE_SENTRY_DSN=` (vazio) em `apps/web/.env.example` se existir.

**Verificação:**
- [ ] `bun run build` sem erros
- [ ] Com `VITE_SENTRY_DSN` ausente: app carrega sem erro no browser
- [ ] `bunx tsc --noEmit` sem erros

---

### T5 — Sentry: error boundary em __root.tsx

**Arquivo:** `apps/web/src/routes/__root.tsx`

**Adicionar componente `ErrorFallback`:**
```tsx
function ErrorFallback() {
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <p>Algo deu errado.</p>
      <button onClick={() => window.location.reload()}>Recarregar</button>
    </div>
  );
}
```

**Envolver `<Outlet />` com `<Sentry.ErrorBoundary>`:**
```tsx
import * as Sentry from '@sentry/react';

// em RootComponent:
return (
  <>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <Outlet />
    </Sentry.ErrorBoundary>
    <Toaster position="bottom-right" richColors />
  </>
);
```

**Nota:** `<Sentry.ErrorBoundary>` funciona mesmo sem DSN configurado (não inicializa Sentry mas o componente existe).

**Verificação:**
- [ ] `bunx tsc --noEmit` sem erros
- [ ] `bun run dev`: app carrega, sem erros no console
- [ ] Lançar erro manualmente em filho → `ErrorFallback` renderiza

---

### T6 — ADR 001: RLS strategy

**Criar:** `docs/adrs/001-rls-strategy.md`

Conteúdo deve cobrir:
- Contexto: multi-owner futuro, RLS como camada de segurança
- Decisão: policies por `ownerId` em todas as tabelas, ativadas em f2b (pré-produção)
- Policies por tabela: Owner, Property, Lead, Tenant, Payment, Contract, ContractTemplate, RuleSet, ActivityLog, Conversation, Event, PropertyMedia, LeadDocument
- Status: documentado, implementação SQL pendente para f2b
- Consequências: queries web precisam incluir `.eq('ownerId', session.user.id)` antes de ativar

**Verificação:**
- [ ] Arquivo criado com todas as seções
- [ ] Policies listadas para cada tabela principal

---

### T7 — docs/deploy.md: checklist de env vars

**Criar:** `docs/deploy.md`

Conteúdo deve cobrir:

**Bot (`apps/bot`):**
Todas as env vars de `apps/bot/src/config.ts` (obrigatórias vs opcionais, valores default, onde obter)

**Web (`apps/web`):**
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_BOT_API_URL`
- `VITE_SENTRY_DSN` (opcional)

**Verificação:**
- [ ] Arquivo criado
- [ ] Toda var de `apps/bot/src/config.ts` aparece no checklist
- [ ] Seção Bot e seção Web separadas

---

## Checkpoint final

Após T1–T7:

```bash
# bot
cd apps/bot && bunx tsc --noEmit
grep -rn "console\." src --include="*.ts"   # deve retornar vazio

# web
cd apps/web && bunx tsc --noEmit
bun run build
grep -r "setupWorker\|msw" dist/assets/*.js  # deve retornar vazio
```

Tudo verde → pronto para /simplify → /review → COMMIT.
