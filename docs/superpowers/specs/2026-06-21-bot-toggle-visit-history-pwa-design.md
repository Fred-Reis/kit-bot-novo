# Design: Bot global toggle + histórico de visitas + PWA

**Data:** 2026-06-21
**Status:** aprovado

---

## Contexto

Três melhorias independentes de produto identificadas em uso real do sistema:

1. **Bot global disable** — hoje desligar o bot exige desconectar a instância no painel da Evolution API. O proprietário precisa de um toggle no dashboard.
2. **Histórico no calendário de visitas** — visitas concluídas, canceladas ou passadas desaparecem do calendário. O proprietário quer ver o histórico completo com filtros de status.
3. **PWA install-only** — o sistema é web desktop mas deve ser instalável como app no celular e computador via "Adicionar à tela inicial".

O sign-up self-service (quarta ideia levantada) já está documentado em detalhe na Fase 5 do ROADMAP.md — não será redesenhado aqui.

---

## Feature 1 — Bot global disable toggle

### Schema

Migration: adicionar campo `botEnabled` na tabela `Owner`.

```prisma
model Owner {
  // ...campos existentes...
  botEnabled Boolean @default(true)
}
```

### Bot — webhook (`apps/bot`)

Em `webhooks/evolution.ts`, no início do handler de mensagem, após identificar o `ownerId`:

1. Consulta `botEnabled` do owner. Para evitar hit no banco em cada mensagem, cacheia resultado no Redis com chave `bot:enabled:{ownerId}` e TTL de 60 segundos.
2. Se `botEnabled === false`, responde 200 ao webhook sem processar a mensagem. Nenhuma resposta é enviada ao lead.
3. Mensagens continuam chegando normalmente ao WhatsApp do proprietário (Evolution permanece conectado — sem logout, sem QR code).

### Endpoint (`apps/bot`)

```
PATCH /admin/workspace/bot-enabled
Body: { enabled: boolean }
Auth: Supabase JWT (header Authorization)
```

- Atualiza `Owner.botEnabled` via Prisma
- Invalida cache Redis `bot:enabled:{ownerId}`
- Escreve activity log: `bot_globally_paused` ou `bot_globally_resumed`
- Retorna `{ enabled: boolean }`

### Web — Config > Integrações (`apps/web`)

Na seção "Integrações" da página `/config`, adiciona card "Bot WhatsApp" com:

- **Toggle** on/off (componente `Toggle` existente)
- **Label dinâmica**: "Bot ativo" (verde) / "Bot pausado" (amarelo)
- **Texto auxiliar** quando desligado: _"Mensagens chegam normalmente no seu WhatsApp. Você responde manualmente."_
- **Comportamento**: atualização otimista — toggle muda imediatamente, reverte se a chamada falhar com toast de erro
- **Carregamento inicial**: nova query `fetchOwner()` em `lib/queries.ts` lê a row `Owner` via supabase-js filtrada pelo `auth.uid()` do usuário logado, retornando `botEnabled`. Usada via `useQuery(['owner'])` na seção Integrações.

### Activity log

| Ação | Quando |
|---|---|
| `bot_globally_paused` | toggle → false |
| `bot_globally_resumed` | toggle → true |

Actor: owner (via web).

---

## Feature 2 — Histórico no calendário de visitas

### Query ampliada (`apps/web/src/lib/queries.ts`)

`fetchVisits()` passa a retornar **todos os leads com `scheduledVisitAt IS NOT NULL`**, sem filtros de stage ou archivedAt. Campos adicionais retornados: `visitedAt`, `archivedAt`.

```typescript
// Antes:
.eq('stage', 'visiting')
.is('archivedAt', null)
.is('visitedAt', null)

// Depois:
.not('scheduledVisitAt', 'is', null)
// sem filtros de stage, archivedAt ou visitedAt
```

Tipo `VisitEntry` ganha `visitedAt: string | null` e `archivedAt: string | null`.

### Status derivado (`apps/web/src/lib/visit-utils.ts`)

Novo utilitário `visitStatus(lead: VisitEntry): VisitStatus`:

```
archivedAt != null            → 'cancelled'
visitedAt != null             → 'completed'
scheduledVisitAt < now()      → 'past'        (data passou, visita não foi marcada como concluída)
scheduledVisitAt >= now()     → 'upcoming'
scheduledVisitAt == null      → 'unscheduled' (sem horário definido)
```

```typescript
type VisitStatus = 'upcoming' | 'unscheduled' | 'completed' | 'cancelled' | 'past';
```

### Filter chips (UI)

Barra horizontal acima do header semanal em `routes/_dashboard/visits/index.tsx`:

```
[ Todas ] [ Agendadas ] [ Sem horário ] [ Concluídas ] [ Canceladas ] [ Não realizadas ]
```

- Estado local: `Set<VisitStatus>` com filtros ativos
- Default ao carregar: `{ 'upcoming', 'unscheduled' }` — comportamento idêntico ao atual
- Seleção múltipla: chips toggle individualmente
- "Todas" seleciona/deseleciona tudo
- Filtragem 100% client-side — sem nova chamada ao banco

### Visual dos cards por status (`VisitCard`)

| Status | Visual |
|---|---|
| `upcoming` | sem mudança (visual atual) |
| `unscheduled` | sem mudança (visual atual) |
| `completed` | badge verde "Concluída" + opacidade 70% |
| `cancelled` | badge cinza "Cancelada" + nome com line-through |
| `past` | badge amarelo "Não realizada" + opacidade 70% |

### Reativar visita cancelada

`VisitCard` com status `cancelled` exibe botão "Reativar". Chama endpoint existente:
```
PATCH /admin/leads/:id/archive
Body: { archived: false }
```
Já implementado no Slice 1. Após sucesso: invalida query `['visits']`, lead retorna ao calendário como `upcoming` ou `unscheduled`.

### Sem migration

Todos os campos necessários (`scheduledVisitAt`, `visitedAt`, `archivedAt`) já existem no schema. Nenhuma alteração no banco.

---

## Feature 3 — PWA install-only

### Dependências (`apps/web`)

```bash
bun add -D vite-plugin-pwa @vite-pwa/assets-generator
```

### `vite.config.ts`

```typescript
import { VitePWA } from 'vite-plugin-pwa';

// dentro de plugins:
VitePWA({
  registerType: 'autoUpdate',
  includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icon-tile-*.svg'],
  manifest: {
    name: 'kit-manager',
    short_name: 'kit-manager',
    description: 'Painel do proprietário — gestão de locação',
    theme_color: '#0f172a',
    background_color: '#0f172a',
    display: 'standalone',
    start_url: '/',
    icons: [
      { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
      { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    // service worker mínimo — só garante installability
    // sem cache de dados de API
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
    runtimeCaching: [], // sem cache de runtime
  },
})
```

### Geração de ícones

Script em `package.json` do web:
```json
"generate-pwa-assets": "pwa-assets-generator --preset minimal public/icon-tile-dark.svg"
```

Gera: `pwa-192x192.png`, `pwa-512x512.png`, `apple-touch-icon.png` em `public/`.

### `index.html`

```html
<meta name="theme-color" content="#0f172a" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="kit-manager" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
```

### Comportamento por plataforma

| Plataforma | Como instalar |
|---|---|
| Android Chrome | Prompt nativo automático após visitas recorrentes |
| iOS Safari | Compartilhar → Adicionar à Tela de Início |
| Desktop Chrome/Edge | Ícone de instalação na barra de endereço |

Quando instalado: abre em modo `standalone` sem barra de browser.

**Sem prompt customizado** na UI por ora — browser exibe o prompt nativo. Banner "instale o app" pode ser adicionado futuramente.

---

## Impacto no ROADMAP.md

### Adicionar no Backlog de features (seção existente):

**Bot global disable** → nova entrada em "Bot — features pendentes"
**Histórico de visitas** → atualizar entrada "Calendário de visitas V1" (V1 já inclui histórico)
**PWA** → nova entrada em "Infraestrutura"

### Fase 5 — Multi-tenancy (já documentada)

Sign-up self-service com isolamento por owner já está documentado em Fase 5. Não requer alteração.

---

## Arquivos afetados

### Bot (`apps/bot`)
- `prisma/schema.prisma` — campo `Owner.botEnabled`
- `prisma/migrations/` — nova migration
- `src/webhooks/evolution.ts` — check `botEnabled` no início do handler
- `src/routes/admin.ts` — endpoint `PATCH /admin/workspace/bot-enabled`

### Web (`apps/web`)
- `vite.config.ts` — plugin PWA
- `index.html` — meta tags PWA
- `public/` — ícones gerados
- `package.json` — deps + script `generate-pwa-assets`
- `src/lib/queries.ts` — `fetchVisits()` ampliada + tipo `VisitEntry` atualizado + nova `fetchOwner()`
- `src/lib/visit-utils.ts` — novo utilitário `visitStatus()`
- `src/routes/_dashboard/visits/index.tsx` — filter chips + render condicional por status
- `src/components/visits/visit-card.tsx` — visual por status + botão Reativar
- `src/routes/_dashboard/config/index.tsx` — card "Bot WhatsApp" na seção Integrações
- `src/lib/api.ts` — `updateBotEnabled(enabled: boolean)`
