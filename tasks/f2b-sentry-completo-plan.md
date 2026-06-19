# Plan — F2B: Sentry Completo

> Spec: specs/f2b-sentry-completo.md  
> Ordem: dependência → T01 → T02 → T03 → T04 → T05

---

## T01 — Instalar @sentry/vite-plugin

**Arquivos afetados:**
- `apps/web/package.json`
- `bun.lockb`

**Ação:**
```bash
cd apps/web && bun add -D @sentry/vite-plugin
```

**Verificação:**
```bash
grep "@sentry/vite-plugin" apps/web/package.json
```

**Critério de pronto:** pacote aparece em `devDependencies` do `package.json`.

---

## T02 — Configurar sentryVitePlugin no vite.config.ts

**Arquivos afetados:**
- `apps/web/vite.config.ts`

**Ação:**
- Importar `sentryVitePlugin` de `@sentry/vite-plugin`
- Adicionar ao array `plugins` com `enabled: process.env.NODE_ENV === 'production'` (não sobe source maps em dev)
- Configuração lê `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` do ambiente (não hardcodear)

**Resultado esperado:**
```ts
import { sentryVitePlugin } from '@sentry/vite-plugin';

plugins: [
  tanstackRouter({ target: 'react', autoCodeSplitting: true }),
  react(),
  tailwindcss(),
  sentryVitePlugin({
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    telemetry: false,
  }),
],
```

**Verificação:**
```bash
cd apps/web && bunx tsc --noEmit
```

**Critério de pronto:** tsc verde, plugin presente no config.

---

## T03 — Adicionar router tracing integration no main.tsx

**Arquivos afetados:**
- `apps/web/src/main.tsx`

**Ação:**
- Mover bloco `Sentry.init()` para **depois** da declaração de `router` (necessário para passar a referência)
- Adicionar `integrations: [Sentry.tanstackRouterBrowserTracingIntegration({ router })]` no `Sentry.init()`

**Resultado esperado (ordem no arquivo):**
```ts
const queryClient = new QueryClient({ ... });
const router = createRouter({ ... });

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    integrations: [Sentry.tanstackRouterBrowserTracingIntegration({ router })],
    beforeSend(event) {
      if (event.request) delete event.request.data;
      return event;
    },
  });
}
```

**Verificação:**
```bash
cd apps/web && bunx tsc --noEmit
```

**Critério de pronto:** tsc verde, integration presente, `Sentry.init()` posicionado após `router`.

---

## T04 — Adicionar Sentry.setUser no __root.tsx

**Arquivos afetados:**
- `apps/web/src/routes/__root.tsx`

**Ação:**
- No callback `onAuthStateChange`, quando `session !== null`: chamar `Sentry.setUser({ email: session.user.email ?? session.user.id })`
- Quando `session === null`: chamar `Sentry.setUser(null)`

**Resultado esperado (dentro do useEffect):**
```ts
const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
  setSession(session);
  if (session) {
    Sentry.setUser({ email: session.user.email ?? session.user.id });
  } else {
    Sentry.setUser(null);
  }
});
```

**Verificação:**
```bash
cd apps/web && bunx tsc --noEmit && bunx oxlint src/
```

**Critério de pronto:** tsc + oxlint verdes, `setUser` chamado em login e logout.

---

## T05 — Atualizar docs/deploy.md

**Arquivos afetados:**
- `docs/deploy.md`

**Ação:**
- Adicionar tabela de variáveis de build do Sentry na seção Painel (ou seção Sentry dedicada)
- Documentar `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` como variáveis de **build** (não runtime, não `VITE_*`)
- Marcar checklist items do Sentry como implementados onde aplicável
- Nota: `SENTRY_AUTH_TOKEN` é secret — setar apenas no Vercel, nunca commitar

**Verificação:** leitura manual do arquivo resultante.

**Critério de pronto:** deploy.md reflete o estado atual da instrumentação.

---

## Ordem de execução

```
T01 (instalar pacote)
  └─→ T02 (vite.config.ts)
        └─→ T03 (main.tsx)
              └─→ T04 (__root.tsx)
                    └─→ T05 (docs)
```

T03 e T04 são independentes entre si — podem ser feitos em qualquer ordem após T02.

---

## Verificação final (após T05)

```bash
cd apps/web && bunx tsc --noEmit && bunx oxlint src/
```

Zero erros novos = pronto para commit.
