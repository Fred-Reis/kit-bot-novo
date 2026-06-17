# Deploy Checklist — kit-manager

> Preencher antes de subir qualquer ambiente (staging ou produção).

---

## Bot (`apps/bot`)

| Variável | Obrigatória | Default | Onde obter |
|---|---|---|---|
| `OPENAI_API_KEY` | ✅ | — | [platform.openai.com](https://platform.openai.com) → API keys |
| `OPENAI_MODEL_NAME` | Não | `gpt-4o-mini` | Qualquer modelo disponível na conta |
| `EVOLUTION_API_URL` | ✅ | — | URL da instância Evolution API (ex: `https://evo.seudominio.com`) |
| `EVOLUTION_INSTANCE_NAME` | ✅ | — | Nome da instância configurada no painel Evolution |
| `EVOLUTION_API_KEY` | ✅ | — | Painel Evolution → Settings → API Key |
| `DATABASE_URL` | ✅ | — | Supabase → Project Settings → Database → Connection pooler (Transaction mode) |
| `DIRECT_URL` | ✅ (migrations) | — | Supabase → Project Settings → Database → Direct connection (Session mode) |
| `SUPABASE_URL` | ✅ | — | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_KEY` | ✅ | — | Supabase → Project Settings → API → `service_role` key (nunca expor no cliente) |
| `REDIS_URL` | Não | `redis://localhost:6379` | URL do Redis (Railway, Upstash, ou instância própria) |
| `PORT` | Não | `3000` | Porta do servidor Fastify |
| `DEBOUNCE_SECONDS` | Não | `5` | Segundos de espera para agrupar mensagens em rajada |
| `BUFFER_TTL_SECONDS` | Não | `3600` | TTL dos buffers no Redis (segundos) |
| `LOG_PAYLOADS` | Não | `false` | `true` para logar payloads de webhook (apenas debug) |
| `LOG_LEVEL` | Não | `info` | Nível do Pino: `debug` \| `info` \| `warn` \| `error` |
| `GOOGLE_CREDENTIALS_JSON` | Não | — | JSON completo da service account do Google Cloud Vision (OCR de documentos). Se ausente, OCR retorna string vazia. |

### Notas

- `DATABASE_URL` deve usar o **pooler** (Transaction mode) para evitar esgotar conexões em produção.
- `DIRECT_URL` é usado apenas pelo Prisma para migrations (`prisma migrate deploy`) — não necessário em runtime.
- `SUPABASE_SERVICE_KEY` bypassa RLS — nunca expor no frontend ou em logs.
- `GOOGLE_CREDENTIALS_JSON`: colar o conteúdo do arquivo JSON completo como string. Em Railway/Fly, usar secrets ou variável de múltiplas linhas.

---

## Painel (`apps/web`)

| Variável | Obrigatória | Descrição |
|---|---|---|
| `VITE_SUPABASE_URL` | ✅ | Supabase → Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Supabase → Project Settings → API → `anon` key (pública, segura para frontend) |
| `VITE_BOT_API_URL` | ✅ | URL base da API do bot sem trailing slash (ex: `https://bot.seudominio.com`) |
| `VITE_SENTRY_DSN` | Não | Sentry → Project → Settings → Client Keys → DSN. Se ausente, Sentry não inicializa. |

### Notas

- Variáveis `VITE_*` são embutidas no bundle em build time. Não use para secrets.
- `VITE_SUPABASE_ANON_KEY` é pública por design — RLS controla o acesso.
- Em Vercel: adicionar no painel → Settings → Environment Variables.

---

## Checklist pré-deploy

### Bot
- [ ] Todas as variáveis obrigatórias preenchidas
- [ ] `bun run build` ou `bun run start` executa sem erro
- [ ] `prisma migrate deploy` aplicado no banco de produção
- [ ] Redis acessível pela URL configurada
- [ ] Evolution API acessível e instância conectada ao WhatsApp
- [ ] Webhook Evolution configurado para `POST https://bot.seudominio.com/webhook`

### Painel
- [ ] Todas as variáveis obrigatórias preenchidas
- [ ] `bun run build` executa sem erro de TypeScript
- [ ] URL do bot acessível a partir do browser (CORS configurado no Fastify)
- [ ] Google OAuth configurado no Supabase Auth (redirect URL para domínio de produção)

### Sentry (completar antes do deploy de produção)

- [ ] Criar projeto no [sentry.io](https://sentry.io) e obter DSN → setar `VITE_SENTRY_DSN` no Vercel
- [ ] Instalar `@sentry/vite-plugin` e configurar upload de source maps no `vite.config.ts` (sem source maps, stack traces em prod são ilegíveis)
- [ ] Adicionar `Sentry.setUser({ email })` após login em `__root.tsx` (erros chegam sem identificar o usuário logado sem isso)
- [ ] Opcional: integração TanStack Router para rastrear rota ativa no erro (`Sentry.tanstackRouterBrowserTracingIntegration`)

### Banco
- [ ] Supabase backups automáticos habilitados (Supabase Pro ou via pg_dump cron)
- [ ] RLS ativado após testes (ver `docs/adrs/001-rls-strategy.md`)
