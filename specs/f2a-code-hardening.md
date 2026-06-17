# Spec — f2a: Code Hardening

> Pipeline: /spec → /plan → /build → /simplify → /review → COMMIT
> Status: spec

---

## Objetivo

Preparar a codebase para produção antes do deploy (f2b). Quatro frentes independentes:
1. **MSW isolado em dev** — remover MSW do bundle de prod
2. **Logs estruturados no bot** — substituir `console.*` por Pino com output JSON
3. **Error tracking no web** — instalar e configurar Sentry React
4. **RLS documentado** — ADR com políticas definidas, sem ativar ainda

---

## Escopo

### In
- `apps/web/src/main.tsx`: dynamic import de MSW só em DEV
- `apps/bot`: instalar Pino, criar wrapper de logger, substituir `console.*` nos arquivos de produção (não em scripts)
- `apps/web`: instalar `@sentry/react`, inicializar no `main.tsx`, capturar erros em `__root.tsx`
- `docs/adrs/001-rls-strategy.md`: documentar policies por tabela (Row Level Security), sem SQL no banco ainda
- `docs/deploy.md`: checklist de variáveis de ambiente para bot e web em produção

### Out
- Ativar RLS no Supabase (→ f2b)
- Deploy real (→ f2b)
- Sentry para o bot (→ opcional, futuro)
- Substituir `console.*` em scripts/seeds (não são código de produção)
- Qualquer mudança de comportamento funcional

---

## Schema changes

Nenhum.

---

## Tipos

Nenhum novo tipo em `packages/types`.

`apps/bot`: adicionar `src/lib/logger.ts` — exporta instância Pino tipada.

---

## Bot changes

### Instalar Pino
```
cd apps/bot && bun add pino
bun add -d @types/pino  # se necessário
```

### `src/lib/logger.ts`
```ts
import pino from 'pino';
export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
```

### Substituição de console.*
- Arquivos alvo: `src/app.ts`, `src/webhooks/`, `src/flows/`, `src/agents/`, `src/services/`, `src/db/`
- `console.log(...)` → `logger.info(...)`
- `console.error(...)` → `logger.error(...)`
- `console.warn(...)` → `logger.warn(...)`
- Manter assinatura compatível: Pino aceita `(obj, msg)` ou `(msg)` — adaptar chamadas que passam apenas string

### Variável de ambiente nova
| Variável | Default | Descrição |
|---|---|---|
| `LOG_LEVEL` | `info` | Nível do logger Pino (`debug`, `info`, `warn`, `error`) |

Adicionar em `.env.example` e em `docs/deploy.md`.

---

## Web changes

### MSW — dynamic import
`apps/web/src/main.tsx` — trocar import estático por dynamic:

```ts
// antes (import estático — entra no bundle de prod)
import { worker } from './mocks/browser';
if (import.meta.env.DEV) {
  await worker.start({ onUnhandledRequest: 'bypass' });
}

// depois (dynamic import — não entra no bundle de prod)
if (import.meta.env.DEV) {
  const { worker } = await import('./mocks/browser');
  await worker.start({ onUnhandledRequest: 'bypass' });
}
```

### Sentry React
```
cd apps/web && bun add @sentry/react
```

**Inicialização** em `main.tsx` (antes de `createRoot`):
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

**Error boundary** em `apps/web/src/routes/__root.tsx`:
- Envolver `<RouterProvider>` (ou o outlet) com `<Sentry.ErrorBoundary fallback={<ErrorFallback />}>`
- Criar componente `ErrorFallback` simples: título + botão "Recarregar"

**Variável de ambiente nova:**
| Variável | Obrigatória | Descrição |
|---|---|---|
| `VITE_SENTRY_DSN` | Não (guard no código) | DSN do projeto Sentry. Se ausente, Sentry não inicializa. |

### Verificação de build
Após as mudanças, rodar `bun run build` e confirmar que:
1. Bundle não inclui `msw` (verificar com `bunx vite-bundle-visualizer` ou `grep msw dist/`)
2. Build completa sem erros TypeScript

---

## Activity log keys

Nenhum. Code hardening não gera eventos de negócio.

---

## Notificações

Nenhuma.

---

## Critérios de aceite

### MSW

- [x] `bun run build` gera bundle sem referência a `msw` — MSW removido completamente (handlers estavam vazios)
- [x] Em dev, MSW não era usado (N/A — removido por decisão durante build)

### Logs bot

- [x] `bun run dev` do bot: output é JSON com campos `level`, `time`, `msg` (Pino instalado)
- [x] `logger.error` recebe objeto de erro — padrão `{ err }` aplicado em todas as chamadas
- [x] Nenhum `console.log/warn/error` remanescente em `src/` — confirmado por grep (0 ocorrências)

### Sentry

- [x] `VITE_SENTRY_DSN` ausente → app inicializa normalmente — guard `if (import.meta.env.VITE_SENTRY_DSN)`
- [x] `VITE_SENTRY_DSN` presente → Sentry.init chamado com DSN, env, tracesSampleRate e beforeSend
- [x] Error boundary renderiza `ErrorFallback` ao lançar erro em filho — `<Sentry.ErrorBoundary>` em `__root.tsx`

### Documentação

- [x] `docs/adrs/001-rls-strategy.md` criado com decisão, contexto, policies por tabela, status "desativado até f2b"
- [x] `docs/deploy.md` criado com checklist completo de env vars bot + web, obrigatórias vs opcionais

---

## Riscos

| Risco | Probabilidade | Mitigação |
|---|---|---|
| Pino quebra tipos em algum `console.error(err)` com objeto Error | Baixa | Pino serializa `Error` nativamente com `err` key; adaptar chamadas se necessário |
| `@sentry/react` aumenta bundle size significativamente | Média | Sentry com lazy init + `tracesSampleRate: 0.1`; avaliar bundle após build |
| Dynamic import de MSW quebra HMR ou ordem de inicialização | Baixa | Padrão documentado pela MSW; `await` antes de `createRoot` mantém ordem |
| RLS document incorreto gera policies erradas em f2b | Média | Review do ADR antes de f2b, não há SQL no banco ainda |
