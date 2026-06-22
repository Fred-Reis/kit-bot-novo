# Bot toggle + histórico de visitas + PWA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Adicionar toggle global do bot nas configurações, histórico completo no calendário de visitas, e suporte a instalação PWA.

**Architecture:** Três features independentes. Bot toggle: flag `Owner.botEnabled` verificada no `router.ts` com cache Redis 60s, endpoint `PATCH /admin/workspace/bot-enabled`, UI em Config > Integrações. Histórico de visitas: ampliar `fetchVisits()` para buscar todos com `scheduledVisitAt != null`, derivar status no client com `visitStatus()`, filter chips na UI. PWA: `vite-plugin-pwa` com manifest + service worker mínimo para installability.

**Tech Stack:** Bun, Prisma (Postgres), Fastify, ioredis, React 19, TanStack Query, Tailwind v4, shadcn/ui, Vitest, vite-plugin-pwa

## Global Constraints

- Package manager: `bun` — nunca `npm` ou `yarn`
- Lint: Oxlint (`bunx oxlint`)
- Componentes React: named export, `tv()` para variantes, `twMerge()` para merge, `data-slot="nome"` no root, cores via CSS variables (nunca `bg-blue-500`)
- Sem `export default` em componentes React
- Sem barrel files em pastas internas
- Sem Python
- Nomes de arquivo componentes: lowercase com hífens (`visit-card.tsx`)
- Testes: Vitest com `describe`/`test`/`expect` (não `it`)

---

## File Map

### Task 1 — Bot toggle: schema + backend
- Modify: `apps/bot/prisma/schema.prisma` — adicionar `botEnabled Boolean @default(true)` ao model `Owner`
- Create: `apps/bot/prisma/migrations/20260621000002_owner_bot_enabled/migration.sql`
- Modify: `apps/bot/src/flows/router.ts` — checar `owner.botEnabled` com cache Redis antes de processar mensagem
- Modify: `apps/bot/src/routes/admin.ts` — novo endpoint `PATCH /admin/workspace/bot-enabled`

### Task 2 — Bot toggle: web UI
- Modify: `apps/web/src/lib/queries.ts` — nova função `fetchOwner()` que lê `Owner` via supabase-js
- Modify: `apps/web/src/lib/api.ts` — nova função `updateBotEnabled(enabled: boolean)`
- Modify: `apps/web/src/routes/_dashboard/config/index.tsx` — card "Bot WhatsApp" na seção Integrações

### Task 3 — Histórico de visitas: data layer
- Modify: `apps/web/src/lib/queries.ts` — ampliar `fetchVisits()` e tipo `VisitEntry`
- Create: `apps/web/src/lib/visit-utils.ts` — função `visitStatus(visit: VisitEntry): VisitStatus`
- Create: `apps/web/src/__tests__/visit-utils.test.ts` — testes unitários do `visitStatus()`

### Task 4 — Histórico de visitas: UI
- Modify: `apps/web/src/lib/api.ts` — nova função `reactivateVisit(leadId: string)`
- Modify: `apps/web/src/components/visits/visit-card.tsx` — visual por status + botão Reativar
- Modify: `apps/web/src/routes/_dashboard/visits/index.tsx` — filter chips + filtragem client-side

### Task 5 — PWA install-only
- Modify: `apps/web/package.json` — deps `vite-plugin-pwa`, `@vite-pwa/assets-generator` + script `generate-pwa-assets`
- Modify: `apps/web/vite.config.ts` — plugin VitePWA
- Modify: `apps/web/index.html` — meta tags Apple/theme-color
- Run: `bun run generate-pwa-assets` — gera ícones em `apps/web/public/`

---

## Task 1: Bot toggle — schema + backend

**Files:**
- Modify: `apps/bot/prisma/schema.prisma`
- Create: `apps/bot/prisma/migrations/20260621000002_owner_bot_enabled/migration.sql`
- Modify: `apps/bot/src/flows/router.ts`
- Modify: `apps/bot/src/routes/admin.ts`

**Interfaces:**
- Produces: `Owner.botEnabled: boolean` no banco; cache Redis `bot:enabled:{ownerId}` (string `'1'`/`'0'`, TTL 60s); endpoint `PATCH /admin/workspace/bot-enabled` body `{ enabled: boolean }` → retorna `{ enabled: boolean }`

- [x] **Step 1: Adicionar `botEnabled` ao model Owner no schema Prisma**

Em `apps/bot/prisma/schema.prisma`, no model `Owner`, adicionar após `notificationEmail`:

```prisma
model Owner {
  id                String             @id @default(uuid())
  name              String
  phone             String             @unique
  email             String?            @unique
  notificationPhone String?
  notificationEmail String?
  botEnabled        Boolean            @default(true)
  properties        Property[]
  // ... demais relações inalteradas
```

- [x] **Step 2: Criar migration SQL**

Criar arquivo `apps/bot/prisma/migrations/20260621000002_owner_bot_enabled/migration.sql`:

```sql
ALTER TABLE "Owner" ADD COLUMN "botEnabled" BOOLEAN NOT NULL DEFAULT true;
```

- [x] **Step 3: Aplicar migration localmente**

```bash
cd apps/bot && bunx prisma migrate dev --name owner_bot_enabled
```

Expected: `✔ Your database is now in sync with your schema.`

- [x] **Step 4: Checar `botEnabled` no router com cache Redis**

Em `apps/bot/src/flows/router.ts`, adicionar verificação logo após `prisma.owner.findFirst()`. O padrão Redis existente (de `catalog.ts`) usa `redis.get` / `redis.set(key, value, 'EX', ttl)`. Importar `redis` de `@/db/redis`:

```typescript
import type { MediaItem } from '@/buffer';
import { prisma } from '@/db/client';
import { redis } from '@/db/redis';
import { handleLeadMessage } from '@/flows/lead/index';
import { handleTenantMessage } from '@/flows/tenant/index';
import { logger } from '@/lib/logger';
import { logActivity } from '@/services/activity';

export async function routeMessage(
  chatId: string,
  text: string | null,
  mediaItems: MediaItem[],
  senderName?: string | null,
): Promise<void> {
  const owner = await prisma.owner.findFirst();
  if (!owner) {
    logger.error('[router] No owner record found — cannot route message');
    return;
  }

  // Check global bot enabled flag (cached 60s in Redis)
  const cacheKey = `bot:enabled:${owner.id}`;
  const cached = await redis.get(cacheKey);
  let botEnabled: boolean;
  if (cached !== null) {
    botEnabled = cached === '1';
  } else {
    botEnabled = owner.botEnabled;
    await redis.set(cacheKey, botEnabled ? '1' : '0', 'EX', 60);
  }
  if (!botEnabled) {
    logger.info({ chatId }, '[router] Bot globally disabled — message suppressed');
    return;
  }

  const [existingLead, tenant, conversation] = await Promise.all([
    prisma.lead.findUnique({
      where: { phone: chatId },
      select: { id: true, name: true, archivedAt: true },
    }),
    prisma.tenant.findUnique({ where: { phone: chatId } }),
    prisma.conversation.findUnique({ where: { chatId }, select: { botPaused: true } }),
  ]);

  if (tenant) {
    await handleTenantMessage(chatId, text);
    return;
  }

  if (conversation?.botPaused) {
    logger.info({ chatId }, '[router] Bot paused — message suppressed');
    return;
  }

  const isNew = !existingLead;
  const isReactivation = !!existingLead?.archivedAt;

  let lead: { id: string; name: string | null };
  if (isNew) {
    lead = await prisma.lead.create({
      data: { phone: chatId, stage: 'interest', source: 'whatsapp', ownerId: owner.id, name: senderName ?? null },
    });
    logActivity({
      ownerId: owner.id,
      actorType: 'bot',
      actorLabel: 'Bot',
      action: 'lead_created',
      subjectType: 'lead',
      subjectId: lead.id,
      subject: chatId,
    }).catch((err) => logger.error({ err }, '[router] logActivity lead_created failed'));
  } else if (isReactivation) {
    lead = await prisma.lead.update({
      where: { phone: chatId },
      data: { archivedAt: null, reactivatedAt: new Date() },
    });
    logActivity({
      ownerId: owner.id,
      actorType: 'bot',
      actorLabel: 'Bot',
      action: 'lead_reactivated',
      subjectType: 'lead',
      subjectId: lead.id,
      subject: lead.name ?? chatId,
    }).catch((err) => logger.error({ err }, '[router] logActivity lead_reactivated failed'));
  } else {
    lead = existingLead;
  }

  await handleLeadMessage(chatId, text, mediaItems, owner.id);
}
```

- [x] **Step 5: Adicionar endpoint `PATCH /admin/workspace/bot-enabled` em `admin.ts`**

Em `apps/bot/src/routes/admin.ts`, dentro de `adminRoutes`, adicionar antes do primeiro endpoint existente (logo após a abertura da função):

```typescript
// ─── bot global toggle ────────────────────────────────────────────────────
fastify.patch<{ Body: { enabled: boolean } }>(
  '/admin/workspace/bot-enabled',
  { preHandler: verifyAdminJwt },
  async (request, reply) => {
    const { enabled } = request.body;
    if (typeof enabled !== 'boolean') {
      return reply.status(400).send({ error: 'enabled must be a boolean' });
    }
    const owner = await prisma.owner.findFirst();
    if (!owner) return reply.status(404).send({ error: 'Owner not found' });

    await prisma.owner.update({ where: { id: owner.id }, data: { botEnabled: enabled } });

    // Invalidate Redis cache
    await redis.del(`bot:enabled:${owner.id}`);

    logActivity({
      ownerId: owner.id,
      actorType: 'owner',
      actorLabel: request.adminUserId ?? 'Admin',
      action: enabled ? 'bot_globally_resumed' : 'bot_globally_paused',
      subjectType: 'workspace',
      subjectId: owner.id,
      subject: 'Bot WhatsApp',
    }).catch(() => {});

    return reply.send({ enabled });
  },
);
```

Também importar `redis` no topo de `admin.ts` se ainda não importado:

```typescript
import { redis } from '@/db/redis';
```

- [x] **Step 6: Checar tipos**

```bash
cd apps/bot && bunx tsc --noEmit
```

Expected: zero erros.

- [x] **Step 7: Commit**

```bash
git add apps/bot/prisma/schema.prisma \
        apps/bot/prisma/migrations/20260621000002_owner_bot_enabled/ \
        apps/bot/src/flows/router.ts \
        apps/bot/src/routes/admin.ts
git commit -m "feat(bot): add global botEnabled toggle with Redis cache"
```

---

## Task 2: Bot toggle — web UI

**Files:**
- Modify: `apps/web/src/lib/queries.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/routes/_dashboard/config/index.tsx`

**Interfaces:**
- Consumes: endpoint `PATCH /admin/workspace/bot-enabled` (Task 1)
- Consumes: tabela `Owner` via supabase-js com campo `botEnabled`
- Produces: `fetchOwner(): Promise<{ id: string; botEnabled: boolean }>` em `queries.ts`; `updateBotEnabled(enabled: boolean): Promise<void>` em `api.ts`

- [x] **Step 1: Adicionar `fetchOwner()` em `queries.ts`**

Em `apps/web/src/lib/queries.ts`, adicionar ao final do arquivo (antes ou depois de `fetchVisits`, tanto faz):

```typescript
export interface OwnerSettings {
  id: string;
  botEnabled: boolean;
}

export async function fetchOwner(): Promise<OwnerSettings> {
  const { data, error } = await supabase
    .from('Owner')
    .select('id, botEnabled')
    .single();
  if (error) throw error;
  return data as OwnerSettings;
}
```

- [x] **Step 2: Adicionar `updateBotEnabled()` em `api.ts`**

Em `apps/web/src/lib/api.ts`, adicionar à coleção `adminApi` (o objeto que já contém `pauseLead`, `archiveLead`, etc.):

```typescript
updateBotEnabled: (enabled: boolean) =>
  botApi.patch('/admin/workspace/bot-enabled', { enabled }),
```

- [x] **Step 3: Adicionar card "Bot WhatsApp" na seção Integrações do Config**

Em `apps/web/src/routes/_dashboard/config/index.tsx`, localizar a função `IntegrationsSection` (que renderiza os campos de Evolution URL/instância). Adicionar o card do bot no topo dela:

```typescript
function BotToggleCard() {
  const qc = useQueryClient();
  const { data: owner } = useQuery({ queryKey: ['owner'], queryFn: fetchOwner });
  const [optimistic, setOptimistic] = useState<boolean | null>(null);

  const enabled = optimistic ?? owner?.botEnabled ?? true;

  async function handleToggle() {
    const next = !enabled;
    setOptimistic(next);
    try {
      await adminApi.updateBotEnabled(next);
      void qc.invalidateQueries({ queryKey: ['owner'] });
    } catch {
      setOptimistic(null);
      toast.error('Erro ao atualizar configuração do bot.');
    }
  }

  return (
    <SectionCard title="Bot WhatsApp" subtitle="Controle global do bot de atendimento.">
      <SettingRow label="Bot ativo">
        <div className="flex items-center gap-2">
          <span
            className={twMerge(
              'text-xs font-medium px-2 py-0.5 rounded-full',
              enabled
                ? 'bg-success/10 text-success'
                : 'bg-warning/10 text-warning',
            )}
          >
            {enabled ? 'Ativo' : 'Pausado'}
          </span>
          <Toggle
            pressed={enabled}
            onPressedChange={handleToggle}
            aria-label={enabled ? 'Desativar bot' : 'Ativar bot'}
          />
        </div>
      </SettingRow>
      {!enabled && (
        <p className="mt-2 text-xs text-muted-foreground">
          Mensagens chegam normalmente no seu WhatsApp. Você responde manualmente.
        </p>
      )}
    </SectionCard>
  );
}
```

Adicionar imports necessários no topo do arquivo se não existirem:
```typescript
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { twMerge } from 'tailwind-merge';
import { toast } from 'sonner';
import { adminApi } from '@/lib/api';
import { fetchOwner } from '@/lib/queries';
```

Na função `IntegrationsSection`, renderizar `<BotToggleCard />` como primeiro elemento antes dos campos de Evolution.

- [x] **Step 4: Checar tipos**

```bash
cd apps/web && bunx tsc --noEmit
```

Expected: zero erros.

- [x] **Step 5: Verificar manualmente no browser**

```bash
cd apps/web && bun run dev
```

Abrir `/config` → seção Integrações → confirmar que o card "Bot WhatsApp" aparece com toggle e badge de status.

- [x] **Step 6: Commit**

```bash
git add apps/web/src/lib/queries.ts \
        apps/web/src/lib/api.ts \
        apps/web/src/routes/_dashboard/config/index.tsx
git commit -m "feat(web): bot global toggle em Config > Integrações"
```

---

## Task 3: Histórico de visitas — data layer

**Files:**
- Modify: `apps/web/src/lib/queries.ts`
- Create: `apps/web/src/lib/visit-utils.ts`
- Create: `apps/web/src/__tests__/visit-utils.test.ts`

**Interfaces:**
- Produces: `VisitEntry` atualizado com `visitedAt: string | null` e `archivedAt: string | null`
- Produces: `type VisitStatus = 'upcoming' | 'unscheduled' | 'completed' | 'cancelled' | 'past'`
- Produces: `visitStatus(visit: VisitEntry): VisitStatus` em `visit-utils.ts`

- [x] **Step 1: Escrever o teste que falha primeiro**

Criar `apps/web/src/__tests__/visit-utils.test.ts`:

```typescript
import { describe, test, expect } from 'vitest';
import { visitStatus } from '@/lib/visit-utils';
import type { VisitEntry } from '@/lib/queries';

const BASE: VisitEntry = {
  id: 'lead-1',
  externalId: 'LD-0001',
  name: 'João Silva',
  phone: '5511999999999@s.whatsapp.net',
  stage: 'visiting',
  scheduledVisitAt: null,
  visitedAt: null,
  archivedAt: null,
  propertyId: null,
  property: null,
};

const future = new Date(Date.now() + 86_400_000).toISOString(); // +1 day
const past = new Date(Date.now() - 86_400_000).toISOString();  // -1 day

describe('visitStatus', () => {
  test('archivedAt set → cancelled (regardless of other fields)', () => {
    expect(visitStatus({ ...BASE, scheduledVisitAt: future, archivedAt: past })).toBe('cancelled');
  });

  test('visitedAt set (no archivedAt) → completed', () => {
    expect(visitStatus({ ...BASE, scheduledVisitAt: past, visitedAt: past })).toBe('completed');
  });

  test('scheduledVisitAt in future → upcoming', () => {
    expect(visitStatus({ ...BASE, scheduledVisitAt: future })).toBe('upcoming');
  });

  test('scheduledVisitAt in past, not visited, not archived → past', () => {
    expect(visitStatus({ ...BASE, scheduledVisitAt: past })).toBe('past');
  });

  test('scheduledVisitAt null → unscheduled', () => {
    expect(visitStatus({ ...BASE, scheduledVisitAt: null })).toBe('unscheduled');
  });

  test('cancelled takes priority over completed', () => {
    expect(visitStatus({ ...BASE, visitedAt: past, archivedAt: past })).toBe('cancelled');
  });
});
```

- [x] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd apps/web && bunx vitest run src/__tests__/visit-utils.test.ts
```

Expected: FAIL com `Cannot find module '@/lib/visit-utils'`

- [x] **Step 3: Atualizar `VisitEntry` em `queries.ts` e ampliar `fetchVisits()`**

Em `apps/web/src/lib/queries.ts`, atualizar o tipo `VisitEntry`:

```typescript
export interface VisitEntry {
  id: string;
  externalId: string | null;
  name: string | null;
  phone: string;
  stage: LeadStage;
  scheduledVisitAt: string | null;
  visitedAt: string | null;      // NEW
  archivedAt: string | null;     // NEW
  propertyId: string | null;
  property: { externalId: string | null; address: string; neighborhood: string } | null;
}
```

Atualizar `fetchVisits()`:

```typescript
export async function fetchVisits(): Promise<VisitEntry[]> {
  const { data, error } = await supabase
    .from('Lead')
    .select(
      'id, externalId, name, phone, stage, scheduledVisitAt, visitedAt, archivedAt, propertyId, property:propertyId(externalId, address, neighborhood)',
    )
    .not('scheduledVisitAt', 'is', null)
    .order('scheduledVisitAt', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as unknown as VisitEntry[];
}
```

- [x] **Step 4: Criar `visit-utils.ts`**

Criar `apps/web/src/lib/visit-utils.ts`:

```typescript
import type { VisitEntry } from '@/lib/queries';

export type VisitStatus = 'upcoming' | 'unscheduled' | 'completed' | 'cancelled' | 'past';

export function visitStatus(visit: VisitEntry): VisitStatus {
  if (visit.archivedAt != null) return 'cancelled';
  if (visit.visitedAt != null) return 'completed';
  if (visit.scheduledVisitAt == null) return 'unscheduled';
  return new Date(visit.scheduledVisitAt) >= new Date() ? 'upcoming' : 'past';
}
```

- [x] **Step 5: Rodar os testes e confirmar que passam**

```bash
cd apps/web && bunx vitest run src/__tests__/visit-utils.test.ts
```

Expected: 6 testes PASS

- [x] **Step 6: Checar tipos**

```bash
cd apps/web && bunx tsc --noEmit
```

Expected: zero erros.

- [x] **Step 7: Commit**

```bash
git add apps/web/src/lib/queries.ts \
        apps/web/src/lib/visit-utils.ts \
        apps/web/src/__tests__/visit-utils.test.ts
git commit -m "feat(web): visit history data layer — fetchVisits ampliado + visitStatus()"
```

---

## Task 4: Histórico de visitas — UI

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/components/visits/visit-card.tsx`
- Modify: `apps/web/src/routes/_dashboard/visits/index.tsx`

**Interfaces:**
- Consumes: `visitStatus(visit: VisitEntry): VisitStatus` de `@/lib/visit-utils` (Task 3)
- Consumes: `VisitEntry` com `visitedAt` e `archivedAt` (Task 3)
- Consumes: endpoint existente `PATCH /admin/leads/:id/archive` com body `{ archived: false }` para reativar

- [x] **Step 1: Adicionar `reactivateVisit()` em `api.ts`**

Em `apps/web/src/lib/api.ts`, dentro do objeto `adminApi`:

```typescript
reactivateVisit: (leadId: string) =>
  botApi.patch(`/admin/leads/${leadId}/archive`, { archived: false }),
```

- [x] **Step 2: Atualizar `VisitCard` com visual por status e botão Reativar**

Substituir o conteúdo completo de `apps/web/src/components/visits/visit-card.tsx`:

```typescript
import { useState } from 'react';
import { CheckCircle, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { twMerge } from 'tailwind-merge';
import { adminApi, apiErrorMessage } from '@/lib/api';
import type { VisitEntry } from '@/lib/queries';
import { visitStatus } from '@/lib/visit-utils';
import type { VisitStatus } from '@/lib/visit-utils';

interface VisitCardProps {
  visit: VisitEntry;
  onCompleted: (leadId: string) => void;
  onReactivated: (leadId: string) => void;
  className?: string;
}

function formatVisitTime(iso: string | null): string {
  if (!iso) return 'Hora a confirmar';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Hora a confirmar';
  return d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

const STATUS_BADGE: Record<VisitStatus, { label: string; className: string } | null> = {
  upcoming: null,
  unscheduled: null,
  completed: { label: 'Concluída', className: 'bg-success/10 text-success' },
  cancelled: { label: 'Cancelada', className: 'bg-muted text-muted-foreground' },
  past: { label: 'Não realizada', className: 'bg-warning/10 text-warning' },
};

export function VisitCard({ visit, onCompleted, onReactivated, className }: VisitCardProps) {
  const [loading, setLoading] = useState(false);
  const status = visitStatus(visit);
  const badge = STATUS_BADGE[status];
  const isHistorical = status === 'completed' || status === 'cancelled' || status === 'past';

  const displayName = visit.name ?? visit.phone;
  const time = formatVisitTime(visit.scheduledVisitAt);
  const propertyLabel = visit.property
    ? `${visit.property.externalId ? visit.property.externalId + ' · ' : ''}${visit.property.address}`
    : null;

  async function handleComplete() {
    setLoading(true);
    try {
      await adminApi.completeVisit(visit.id);
      onCompleted(visit.id);
      toast.success('Visita marcada como realizada.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Erro ao marcar visita.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleReactivate() {
    setLoading(true);
    try {
      await adminApi.reactivateVisit(visit.id);
      onReactivated(visit.id);
      toast.success('Visita reativada.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Erro ao reativar visita.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      data-slot="visit-card"
      className={twMerge(
        'rounded-lg bg-surface-raised p-3 flex items-start justify-between gap-2',
        'ring-1 ring-border/50',
        isHistorical && 'opacity-70',
        loading && 'opacity-50 pointer-events-none',
        className,
      )}
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <p className="font-mono text-xs text-muted-foreground">{time}</p>
          {badge && (
            <span className={twMerge('text-xs font-medium px-1.5 py-px rounded-full', badge.className)}>
              {badge.label}
            </span>
          )}
        </div>
        <p className={twMerge('text-sm font-medium text-foreground leading-tight truncate', status === 'cancelled' && 'line-through text-muted-foreground')}>
          {displayName}
        </p>
        {propertyLabel && (
          <p className="text-xs text-muted-foreground truncate">{propertyLabel}</p>
        )}
      </div>

      <div className="shrink-0 mt-0.5 flex items-center gap-1">
        {status === 'cancelled' && (
          <button
            type="button"
            aria-label="Reativar visita"
            onClick={handleReactivate}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            <RotateCcw className="size-4" />
          </button>
        )}
        {(status === 'upcoming' || status === 'unscheduled' || status === 'past') && (
          <button
            type="button"
            aria-label="Marcar como realizada"
            onClick={handleComplete}
            disabled={loading}
            className="text-muted-foreground hover:text-success transition-colors disabled:opacity-40"
          >
            <CheckCircle className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
```

- [x] **Step 3: Adicionar filter chips e filtragem no `visits/index.tsx`**

Substituir o conteúdo de `apps/web/src/routes/_dashboard/visits/index.tsx`:

```typescript
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import { NewVisitModal } from '@/components/visits/new-visit-modal';
import { VisitCard } from '@/components/visits/visit-card';
import { fetchVisits, type VisitEntry } from '@/lib/queries';
import { visitStatus, type VisitStatus } from '@/lib/visit-utils';

export const Route = createFileRoute('/_dashboard/visits/')({
  component: VisitsPage,
});

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

type FilterSet = Set<VisitStatus | 'all'>;

const FILTER_OPTIONS: { value: VisitStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'upcoming', label: 'Agendadas' },
  { value: 'unscheduled', label: 'Sem horário' },
  { value: 'completed', label: 'Concluídas' },
  { value: 'cancelled', label: 'Canceladas' },
  { value: 'past', label: 'Não realizadas' },
];

const DEFAULT_FILTERS = new Set<VisitStatus>(['upcoming', 'unscheduled']);

function VisitsPage() {
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [showModal, setShowModal] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<VisitStatus>>(DEFAULT_FILTERS);

  const { data: visits = [], isLoading, isError } = useQuery({
    queryKey: ['visits'],
    queryFn: fetchVisits,
    refetchInterval: 30_000,
  });

  function handleCompleted(leadId: string) {
    void qc.invalidateQueries({ queryKey: ['visits'] });
  }

  function handleReactivated(leadId: string) {
    void qc.invalidateQueries({ queryKey: ['visits'] });
  }

  function toggleFilter(value: VisitStatus | 'all') {
    if (value === 'all') {
      const allStatuses = new Set<VisitStatus>(['upcoming', 'unscheduled', 'completed', 'cancelled', 'past']);
      setActiveFilters((prev) =>
        prev.size === allStatuses.size ? DEFAULT_FILTERS : allStatuses,
      );
      return;
    }
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
        if (next.size === 0) return DEFAULT_FILTERS;
      } else {
        next.add(value);
      }
      return next;
    });
  }

  const allStatuses = new Set<VisitStatus>(['upcoming', 'unscheduled', 'completed', 'cancelled', 'past']);
  const allActive = activeFilters.size === allStatuses.size;

  const filteredVisits = useMemo(
    () => visits.filter((v) => activeFilters.has(visitStatus(v))),
    [visits, activeFilters],
  );

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const end = addDays(weekStart, 6);
  const weekLabel = `${weekStart.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const visitsByDay = useMemo(() => {
    const map = new Map<string, VisitEntry[]>();
    for (const v of filteredVisits) {
      if (!v.scheduledVisitAt) continue;
      const key = new Date(v.scheduledVisitAt).toLocaleDateString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
      });
      const bucket = map.get(key) ?? [];
      bucket.push(v);
      map.set(key, bucket);
    }
    return map;
  }, [filteredVisits]);

  const unscheduled = useMemo(
    () => filteredVisits.filter((v) => !v.scheduledVisitAt),
    [filteredVisits],
  );

  const today = new Date();

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Calendário de visitas</h1>
          <p className="text-sm text-muted-foreground">Visitas agendadas e histórico</p>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="size-4" />
          Nova visita
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {FILTER_OPTIONS.map(({ value, label }) => {
          const isActive = value === 'all' ? allActive : activeFilters.has(value as VisitStatus);
          return (
            <button
              key={value}
              type="button"
              onClick={() => toggleFilter(value)}
              className={twMerge(
                'rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-transparent text-muted-foreground border-border hover:border-foreground/30',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Week navigation */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Semana anterior"
          onClick={() => setWeekStart((w) => addDays(w, -7))}
          className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="flex-1 text-center text-sm font-medium text-foreground">{weekLabel}</span>
        <button
          type="button"
          aria-label="Próxima semana"
          onClick={() => setWeekStart((w) => addDays(w, 7))}
          className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      {/* Calendar grid */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : isError ? (
        <p className="text-sm text-destructive">Erro ao carregar visitas.</p>
      ) : (
        <div className="grid grid-cols-7 gap-2">
          {weekDays.map((day) => {
            const isToday = isSameDay(day, today);
            const key = day.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
            const dayVisits = visitsByDay.get(key) ?? [];

            return (
              <div key={key} className="flex flex-col gap-1.5">
                <div className={twMerge('text-center pb-1 border-b border-border', isToday && 'border-primary')}>
                  <p className="text-xs text-muted-foreground">{DAY_NAMES[day.getDay()]}</p>
                  <p className={twMerge('text-sm font-semibold', isToday ? 'text-primary' : 'text-foreground')}>
                    {day.getDate()}
                  </p>
                </div>
                {dayVisits.map((v) => (
                  <VisitCard
                    key={v.id}
                    visit={v}
                    onCompleted={handleCompleted}
                    onReactivated={handleReactivated}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Unscheduled */}
      {unscheduled.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sem horário definido
          </p>
          <div className="flex flex-col gap-2">
            {unscheduled.map((v) => (
              <VisitCard
                key={v.id}
                visit={v}
                onCompleted={handleCompleted}
                onReactivated={handleReactivated}
              />
            ))}
          </div>
        </div>
      )}

      {showModal && <NewVisitModal onClose={() => setShowModal(false)} />}
    </div>
  );
}
```

- [x] **Step 4: Checar tipos**

```bash
cd apps/web && bunx tsc --noEmit
```

Expected: zero erros.

- [x] **Step 5: Rodar todos os testes**

```bash
cd apps/web && bunx vitest run
```

Expected: todos os testes passam, incluindo `visit-utils.test.ts`.

- [x] **Step 6: Verificar manualmente no browser**

```bash
cd apps/web && bun run dev
```

- Abrir `/visits`
- Confirmar filter chips visíveis (Todas / Agendadas / Sem horário / Concluídas / Canceladas / Não realizadas)
- Default: Agendadas + Sem horário ativos
- Clicar em "Todas" → todos os chips ativos, visitas históricas aparecem com badge correto
- Visita cancelada: badge "Cancelada" + nome riscado + botão Reativar (RotateCcw icon)
- Clicar Reativar: toast "Visita reativada." + visita desaparece da lista cancelada
- Navegar semanas passadas: visitas históricas aparecem nas colunas corretas

- [x] **Step 7: Commit**

```bash
git add apps/web/src/lib/api.ts \
        apps/web/src/components/visits/visit-card.tsx \
        apps/web/src/routes/_dashboard/visits/index.tsx
git commit -m "feat(web): histórico completo no calendário de visitas com filter chips"
```

---

## Task 5: PWA install-only

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/index.html`
- Generate: `apps/web/public/pwa-192x192.png`, `apps/web/public/pwa-512x512.png`, `apps/web/public/apple-touch-icon.png`

**Interfaces:**
- Produces: `manifest.webmanifest` embutido no build pelo Vite; service worker `sw.js` gerado pelo Workbox; app instalável em Android/iOS/desktop

- [x] **Step 1: Instalar dependências**

```bash
cd apps/web && bun add -D vite-plugin-pwa @vite-pwa/assets-generator
```

Expected: lockfile atualizado, sem erros.

- [x] **Step 2: Adicionar script de geração de ícones ao `package.json`**

Em `apps/web/package.json`, na chave `scripts`, adicionar:

```json
"generate-pwa-assets": "pwa-assets-generator --preset minimal-2023 public/icon-tile-dark.svg"
```

- [x] **Step 3: Gerar ícones**

```bash
cd apps/web && bun run generate-pwa-assets
```

Expected: arquivos criados em `public/`:
- `pwa-64x64.png`
- `pwa-192x192.png`
- `pwa-512x512.png`
- `maskable-icon-512x512.png`
- `apple-touch-icon-180x180.png`

Se o preset não gerar todos os nomes esperados, verificar o output e ajustar os `src` no manifest (Step 4) conforme os nomes reais gerados.

- [x] **Step 4: Configurar `vite-plugin-pwa` em `vite.config.ts`**

Substituir o conteúdo de `apps/web/vite.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
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
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [],
      },
    }),
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      telemetry: false,
      disable: process.env.NODE_ENV !== 'production',
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    exclude: ['node_modules', 'dist'],
  },
});
```

- [x] **Step 5: Adicionar meta tags ao `index.html`**

Substituir o conteúdo de `apps/web/index.html`:

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>kit-manager</title>
    <meta name="theme-color" content="#0f172a" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="kit-manager" />
    <link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [x] **Step 6: Build de produção para validar PWA**

```bash
cd apps/web && bun run build
```

Expected: build sem erros. Verificar que `dist/` contém `manifest.webmanifest` e `sw.js`.

```bash
ls apps/web/dist/ | grep -E "manifest|sw"
```

Expected: `manifest.webmanifest` e `sw.js` presentes.

- [x] **Step 7: Testar installability com Lighthouse (opcional)**

```bash
cd apps/web && bun run preview
```

Abrir Chrome → DevTools → Lighthouse → PWA audit.
Expected: critérios de installability passam (manifest válido, service worker registrado, HTTPS em produção).

- [x] **Step 8: Checar tipos**

```bash
cd apps/web && bunx tsc --noEmit
```

Expected: zero erros.

- [x] **Step 9: Commit**

```bash
git add apps/web/package.json \
        apps/web/vite.config.ts \
        apps/web/index.html \
        apps/web/public/pwa-192x192.png \
        apps/web/public/pwa-512x512.png \
        apps/web/public/maskable-icon-512x512.png \
        apps/web/public/apple-touch-icon-180x180.png \
        apps/web/public/pwa-64x64.png
git commit -m "feat(web): PWA install-only com manifest e service worker mínimo"
```

---

## Self-Review

### Spec coverage

| Requisito da spec | Tarefa |
|---|---|
| `Owner.botEnabled Boolean @default(true)` | Task 1 Step 1–3 |
| Webhook verifica flag com cache Redis 60s | Task 1 Step 4 |
| `PATCH /admin/workspace/bot-enabled` + invalida Redis | Task 1 Step 5 |
| Activity log `bot_globally_paused/resumed` | Task 1 Step 5 |
| `fetchOwner()` em `queries.ts` | Task 2 Step 1 |
| `updateBotEnabled()` em `api.ts` | Task 2 Step 2 |
| Card "Bot WhatsApp" em Config > Integrações com toggle otimista | Task 2 Step 3 |
| `fetchVisits()` busca por `scheduledVisitAt IS NOT NULL` | Task 3 Step 3 |
| `VisitEntry` com `visitedAt` e `archivedAt` | Task 3 Step 3 |
| `visitStatus()` com 5 estados | Task 3 Step 4 |
| Testes unitários `visitStatus()` | Task 3 Step 1/2/5 |
| `reactivateVisit()` em `api.ts` | Task 4 Step 1 |
| `VisitCard` visual por status + botão Reativar | Task 4 Step 2 |
| Filter chips com seleção múltipla, default `upcoming+unscheduled` | Task 4 Step 3 |
| `vite-plugin-pwa` + manifest | Task 5 Step 4 |
| Ícones gerados (`192`, `512`, `maskable`, `apple-touch-icon`) | Task 5 Step 3 |
| Meta tags Apple + theme-color no `index.html` | Task 5 Step 5 |

Cobertura: 100%.
