# slice-11-property-detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completar o detalhe do imóvel — aba Histórico com ActivityLog e sidebar mostrando inquilino atual.

**Architecture:** Duas novas query functions em `queries.ts` alimentam dois componentes novos em `$propertyId/index.tsx`. Nenhuma alteração de schema ou bot.

**Tech Stack:** React 19, TanStack Query, Supabase JS (queries diretas), Bun

---

## Arquivos modificados

| Arquivo | O que muda |
|---|---|
| `apps/web/src/lib/queries.ts` | Adiciona `fetchPropertyActivityLog` e `fetchPropertyTenant` |
| `apps/web/src/routes/_dashboard/properties/$propertyId/index.tsx` | Implementa conteúdo da aba Histórico e sidebar Inquilino |

---

## T01 — Adicionar `fetchPropertyActivityLog` em queries.ts

**Arquivo:** `apps/web/src/lib/queries.ts`

- [x] Confirmar que `ActivityLogEntry` já está exportada no arquivo (linha 148–155). Está — não duplicar.

- [x] Adicionar ao final de `queries.ts`:

  ```typescript
  export async function fetchPropertyActivityLog(propertyId: string): Promise<ActivityLogEntry[]> {
    const { data, error } = await supabase
      .from('ActivityLog')
      .select('id, actorLabel, action, subject, subjectType, createdAt')
      .eq('subjectId', propertyId)
      .order('createdAt', { ascending: false })
      .limit(20);
    if (error) throw error;
    return (data ?? []) as ActivityLogEntry[];
  }
  ```

- [x] Rodar `cd apps/web && bunx tsc --noEmit` — verde

---

## T02 — Adicionar `fetchPropertyTenant` em queries.ts

**Arquivo:** `apps/web/src/lib/queries.ts`

A query retorna o inquilino ativo de um imóvel — apenas os campos necessários para a sidebar (nome, telefone, `onTimeRate` para calcular status).

- [x] Adicionar logo após `fetchPropertyActivityLog`:

  ```typescript
  export interface PropertyTenantSummary {
    id: string;
    name: string | null;
    phone: string;
    onTimeRate: number | null;
  }

  export async function fetchPropertyTenant(
    propertyId: string,
  ): Promise<PropertyTenantSummary | null> {
    const { data, error } = await supabase
      .from('Tenant')
      .select('id, name, phone, onTimeRate')
      .eq('propertyId', propertyId)
      .maybeSingle();
    if (error) throw error;
    return data as PropertyTenantSummary | null;
  }
  ```

- [x] Rodar `cd apps/web && bunx tsc --noEmit` — verde

---

## T03 — Implementar aba Histórico no detalhe do imóvel

**Arquivo:** `apps/web/src/routes/_dashboard/properties/$propertyId/index.tsx`

A aba `history` atualmente mostra "Em construção." (linha 260–267). Vamos substituir por uma lista de ActivityLog.

- [x] Adicionar imports no topo do arquivo. Verificar o que já está importado e adicionar apenas o que faltar:

  ```typescript
  import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
  import { formatActivityLabel } from '@/lib/activity-labels';
  import { relativeTime } from '@/lib/utils';
  import {
    fetchProperty,
    fetchPropertyActivityLog,
    fetchPropertyTenant,
    type ActivityLogEntry,
    type PropertyTenantSummary,
  } from '@/lib/queries';
  ```

- [x] Adicionar o componente `PropertyHistoryTab` antes de `PropertyDetailPage`:

  ```typescript
  function PropertyHistoryTab({ propertyId }: { propertyId: string }) {
    const { data: entries = [], isLoading } = useQuery({
      queryKey: ['property-activity', propertyId],
      queryFn: () => fetchPropertyActivityLog(propertyId),
    });

    if (isLoading) return <div className="h-24 animate-pulse rounded-lg bg-muted" />;

    if (entries.length === 0)
      return <p className="text-sm text-muted-foreground">Nenhuma atividade registrada.</p>;

    return (
      <ul data-slot="activity-list" className="divide-y divide-border">
        {entries.map((entry: ActivityLogEntry) => {
          const actor = entry.actorLabel ?? 'Sistema';
          const verb = formatActivityLabel(entry.action);
          return (
            <li key={entry.id} className="flex items-center justify-between py-3">
              <p className="text-sm text-foreground">
                <span className="font-medium">{actor}</span>{' '}
                {verb}
                {entry.subject && (
                  <>
                    {' '}
                    <span className="font-medium">{entry.subject}</span>
                  </>
                )}
              </p>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {relativeTime(entry.createdAt)}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }
  ```

- [x] Localizar o bloco `{tab === 'history' && (` (modificado na T01 do slice-10). Substituir o conteúdo atual ("Em construção.") por:

  ```typescript
  {tab === 'history' && (
    <div
      className="rounded-[10px] bg-surface-raised p-5"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <h2 className="mb-4 text-sm font-medium text-foreground">Histórico</h2>
      <PropertyHistoryTab propertyId={propertyId} />
    </div>
  )}
  ```

- [x] Rodar `cd apps/web && bunx tsc --noEmit` — verde

---

## T04 — Implementar sidebar Inquilino no detalhe do imóvel

**Arquivo:** `apps/web/src/routes/_dashboard/properties/$propertyId/index.tsx`

A sidebar mostra "Sem inquilino." hardcoded. Vamos substituir por dados reais.

- [x] Confirmar que `Link` e `useNavigate` já estão importados do TanStack Router. Se não, adicionar:

  ```typescript
  import { Link, useNavigate } from '@tanstack/react-router';
  ```

- [x] Adicionar o componente `TenantSidebar` antes de `PropertyDetailPage`:

  ```typescript
  function TenantSidebar({ propertyId }: { propertyId: string }) {
    const { data: tenant, isLoading } = useQuery({
      queryKey: ['property-tenant', propertyId],
      queryFn: () => fetchPropertyTenant(propertyId),
    });

    const statusLabel = (onTimeRate: number | null) => {
      if (onTimeRate == null) return null;
      if (onTimeRate >= 80) return { label: 'Em dia', color: 'text-success' };
      return { label: 'Atenção', color: 'text-warning' };
    };

    if (isLoading) return <div className="h-16 animate-pulse rounded-lg bg-muted" />;

    if (!tenant) return <p className="text-sm text-muted-foreground">Sem inquilino.</p>;

    const status = statusLabel(tenant.onTimeRate);

    return (
      <div data-slot="tenant-summary" className="space-y-2">
        <p className="text-sm font-medium text-foreground">{tenant.name ?? '—'}</p>
        <p className="font-mono text-xs text-muted-foreground">{tenant.phone}</p>
        {status && (
          <span className={`text-xs font-medium ${status.color}`}>{status.label}</span>
        )}
        <Link
          to="/tenants/$tenantId"
          params={{ tenantId: tenant.id }}
          className="block text-xs text-primary hover:underline"
        >
          Ver inquilino →
        </Link>
      </div>
    );
  }
  ```

- [x] Localizar a sidebar atual no JSX — o bloco com `<h3>Inquilino</h3>` e `<p>Sem inquilino.</p>`. Substituir o conteúdo do parágrafo por `<TenantSidebar propertyId={propertyId} />`:

  ```typescript
  <div
    className="rounded-[10px] bg-surface-raised p-5 self-start"
    style={{ boxShadow: 'var(--shadow-sm)' }}
  >
    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      Inquilino
    </h3>
    <TenantSidebar propertyId={propertyId} />
  </div>
  ```

- [x] Rodar `cd apps/web && bunx tsc --noEmit` — verde

- [x] Rodar `cd apps/web && bunx oxlint src/` — sem warnings novos

---

## Verificação final

- [x] Abrir `/properties/:id` de um imóvel **com** inquilino → sidebar mostra nome, telefone, status e link
- [x] Abrir `/properties/:id` de um imóvel **sem** inquilino → sidebar mostra "Sem inquilino."
- [x] Clicar na aba **Histórico** → lista ActivityLog ou "Nenhuma atividade registrada."
- [x] Clicar em "Ver inquilino →" → navega para `/tenants/:id`
- [x] `bunx tsc --noEmit` verde em `apps/web`
- [x] `bunx oxlint src/` sem warnings novos em `apps/web`
