# Spec — F2B: Sentry Completo

> Fase 2 — Hardening pré-produção  
> Status: done

---

## Objetivo

Completar a instrumentação do Sentry no painel web (`apps/web`) para que erros em produção cheguem com stack traces legíveis, rota ativa e identidade do usuário — tornando o Sentry operacional de verdade antes do deploy.

---

## Escopo

### In

- Instalar `@sentry/vite-plugin` e configurar upload de source maps no `vite.config.ts`
- Adicionar `Sentry.setUser()` no `__root.tsx` após autenticação
- Adicionar `Sentry.tanstackRouterBrowserTracingIntegration` no `main.tsx`
- Documentar variáveis de build necessárias no `docs/deploy.md`

### Out

- Nenhuma mudança no `apps/bot` (já usa Pino estruturado)
- Nenhuma mudança de schema ou banco
- Nenhuma mudança de UI
- Não inclui criação da conta/projeto no sentry.io (passo manual do operador)
- Não inclui configuração de alertas/notificações no sentry.io

---

## Schema changes

Nenhuma.

---

## Tipos compartilhados

Nenhum.

---

## Bot changes

Nenhuma.

---

## Web changes

### `apps/web/package.json`
- Adicionar `@sentry/vite-plugin` como devDependency

### `apps/web/vite.config.ts`
- Importar e registrar `sentryVitePlugin` no array `plugins`
- Plugin lê `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` do ambiente de build (Vercel)
- Source maps só sobem em build de produção (`release` automático via plugin)

### `apps/web/src/main.tsx`
- Adicionar `Sentry.tanstackRouterBrowserTracingIntegration()` ao array `integrations` no `Sentry.init()`
- Passar `router` já existente para o integration

### `apps/web/src/routes/__root.tsx`
- No `onAuthStateChange`, quando `session` não é null: chamar `Sentry.setUser({ email: session.user.email })`
- Quando `session` é null (logout): chamar `Sentry.setUser(null)` para limpar

### `docs/deploy.md`
- Seção Sentry: adicionar `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` como variáveis de build (não runtime)
- Marcar itens como implementados onde aplicável

---

## Activity log keys

Nenhum — observabilidade é infraestrutura, não ação de negócio.

---

## Notificações

Nenhuma.

---

## Critérios de aceite

- [x] `bun add -D @sentry/vite-plugin` instalado e lockfile atualizado
- [x] `vite.config.ts` inclui `sentryVitePlugin` sem quebrar o build (`bun run build` verde)
- [x] `bunx tsc --noEmit` verde em `apps/web`
- [x] `Sentry.init()` em `main.tsx` inclui `integrations: [Sentry.tanstackRouterBrowserTracingIntegration({ router })]`
- [x] `__root.tsx` chama `Sentry.setUser({ id, email })` no login e `Sentry.setUser(null)` no logout
- [x] `docs/deploy.md` documenta as 3 variáveis de build do Sentry (`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`)
- [x] Nenhuma regressão em outras features (oxlint verde)

---

## Riscos / edge cases

- **`router` não disponível no escopo do `Sentry.init()`**: o router é criado antes do `init()` no `main.tsx` atual — sem problema, basta passar a referência. Verificar ordem de declaração.
- **Source maps em dev**: o plugin do Vite só deve fazer upload em `mode === 'production'` para não vazar source maps locais. Configurar `disable: process.env.NODE_ENV !== 'production'` ou usar a opção `enabled` do plugin.
- **`SENTRY_AUTH_TOKEN` é secret de build**: não é variável `VITE_*`, não vai pro bundle. Setado apenas no ambiente CI/Vercel, nunca commitado.
- **`session.user.email` pode ser undefined** em Magic Link antes de confirmação — usar `session.user.email ?? session.user.id` como fallback no `setUser`.
