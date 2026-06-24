# Spec — Sentry no Bot

> Fase 2 — Hardening pré-produção
> Status: draft

---

## Objetivo

Instrumentar `apps/bot` com Sentry para capturar erros não-tratados e exceptions do Fastify em produção (Railway), tornando falhas visíveis sem depender só de logs Pino.

---

## Escopo

### In

- Instalar `@sentry/node`
- Inicializar Sentry em `app.ts` antes do Fastify
- Registrar `Sentry.setupFastifyErrorHandler(fastify)` para capturar erros de rotas
- Adicionar `SENTRY_DSN` opcional em `config.ts` (bot não crasha se ausente)
- Documentar variável em `docs/deploy.md`

### Out

- Source maps upload (Railway não tem step de build integrado ao Sentry CLI — escopo futuro)
- Performance/tracing (só erros por ora)
- Nenhuma mudança em `apps/web`
- Nenhuma mudança de schema ou banco
- Criação da conta/projeto no sentry.io (passo manual do operador)
- Configuração de alertas/notificações no sentry.io

---

## Schema changes

Nenhuma.

---

## Tipos compartilhados

Nenhum.

---

## Bot changes

### `apps/bot/package.json`
- Adicionar `@sentry/node` como dependência de produção

### `apps/bot/src/config.ts`
- Adicionar `SENTRY_DSN: z.string().url().optional()` no schema Zod

### `apps/bot/src/app.ts`
- Importar e inicializar Sentry **antes** de criar o Fastify:
  ```ts
  import * as Sentry from '@sentry/node';
  if (config.SENTRY_DSN) {
    Sentry.init({ dsn: config.SENTRY_DSN, environment: process.env.NODE_ENV ?? 'production' });
  }
  ```
- Após criar `fastify` e registrar plugins, antes do `start()`:
  ```ts
  Sentry.setupFastifyErrorHandler(fastify);
  ```

### `docs/deploy.md`
- Seção Bot: adicionar `SENTRY_DSN` como variável de runtime opcional no Railway

---

## Web changes

Nenhuma.

---

## Activity log keys

Nenhum — observabilidade é infraestrutura, não ação de negócio.

---

## Notificações

Nenhuma.

---

## Critérios de aceite

- [ ] `@sentry/node` instalado e lockfile atualizado
- [ ] `SENTRY_DSN` ausente → bot sobe normalmente, sem erro (`optional()` no Zod)
- [ ] `SENTRY_DSN` presente → `Sentry.init()` chamado antes do Fastify
- [ ] `Sentry.setupFastifyErrorHandler(fastify)` registrado após plugins
- [ ] `bunx tsc --noEmit` verde em `apps/bot`
- [ ] `bunx oxlint` sem warnings novos
- [ ] `docs/deploy.md` documenta `SENTRY_DSN` na seção Bot/Railway
- [ ] Nenhuma regressão em outras features

---

## Riscos / edge cases

- **Sentry.init() deve ser a primeira chamada** — se inicializado depois do Fastify, pode não capturar erros de inicialização do servidor. Ordem: `Sentry.init()` → `Fastify()` → plugins → `setupFastifyErrorHandler`.
- **`SENTRY_DSN` opcional no Zod**: usar `z.string().url().optional()` — garante que se setado deve ser URL válida, mas não bloqueia boot sem a var.
- **Não duplicar com Pino**: Sentry captura exceptions não-tratadas; Pino continua logando tudo estruturado. São complementares, não excludentes.
- **Railway não tem NODE_ENV automaticamente**: setar `NODE_ENV=production` nas env vars do Railway explicitamente, ou usar fallback `'production'` no `Sentry.init()`.
