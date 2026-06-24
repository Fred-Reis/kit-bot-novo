# Plan — Sentry no Bot

> Spec: specs/sentry-bot.md
> Slice: sentry-bot
> App afetado: apps/bot

---

## Dependências

```
T01 (instalar dep)
  └─→ T02 (config env var)
        └─→ T03 (init + fastify handler)
              └─→ T04 (documentar deploy.md)
```

---

## Tasks

### T01 — Instalar `@sentry/node`

**Arquivos afetados:**
- `apps/bot/package.json`
- `bun.lockb`

**Ação:**
```bash
cd apps/bot && bun add @sentry/node
```

**Verificação:**
```bash
cd apps/bot && bunx tsc --noEmit
```

**Critério de pronto:**
- `@sentry/node` aparece em `dependencies` do `apps/bot/package.json`
- `bun install` não retorna erro
- TypeCheck verde

---

### T02 — Adicionar `SENTRY_DSN` em `config.ts`

**Arquivos afetados:**
- `apps/bot/src/config.ts`

**Ação:**
Adicionar ao schema Zod:
```ts
SENTRY_DSN: z.string().url().optional(),
```

**Verificação:**
```bash
cd apps/bot && bunx tsc --noEmit && bunx oxlint src/
```

**Critério de pronto:**
- `config.SENTRY_DSN` tipado como `string | undefined`
- Bot sobe sem `SENTRY_DSN` no ambiente (optional)
- TypeCheck + lint verde

---

### T03 — Inicializar Sentry e registrar handler Fastify em `app.ts`

**Arquivos afetados:**
- `apps/bot/src/app.ts`

**Ação:**
1. Importar `* as Sentry from '@sentry/node'` no topo
2. Após `import { config }`, antes de `Fastify()`:
   ```ts
   if (config.SENTRY_DSN) {
     Sentry.init({
       dsn: config.SENTRY_DSN,
       environment: process.env.NODE_ENV ?? 'production',
     });
   }
   ```
3. Após registrar todos os plugins e antes de `start()`:
   ```ts
   Sentry.setupFastifyErrorHandler(fastify);
   ```

**Verificação:**
```bash
cd apps/bot && bunx tsc --noEmit && bunx oxlint src/
```

**Critério de pronto:**
- `Sentry.init()` chamado antes de `Fastify()`
- `Sentry.setupFastifyErrorHandler(fastify)` chamado após plugins
- TypeCheck + lint verde
- `SENTRY_DSN` ausente → nenhum erro no boot

---

### T04 — Documentar `SENTRY_DSN` em `docs/deploy.md`

**Arquivos afetados:**
- `docs/deploy.md`

**Ação:**
Na tabela de variáveis da seção Bot, adicionar linha:

| `SENTRY_DSN` | Não | sentry.io → Project → Settings → Client Keys → DSN. Se ausente, Sentry não inicializa. |

Na checklist de deploy do Bot, adicionar item:
- [ ] Criar projeto no sentry.io (plataforma: Node) e obter DSN → setar `SENTRY_DSN` no Railway

**Verificação:**
Inspeção visual do arquivo.

**Critério de pronto:**
- Variável documentada na tabela
- Item na checklist de deploy
