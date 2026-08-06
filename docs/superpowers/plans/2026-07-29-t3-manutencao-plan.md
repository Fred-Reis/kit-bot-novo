# T3 — Manutenção — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bot atende a trilha de manutenção do inquilino (abrir chamado, indicar profissional) com fotos anexadas; painel ganha `/providers` (CRUD de prestadores) e a seção "Chamados & Reclamações" passa a mostrar também chamados de manutenção com galeria de fotos.

**Architecture:** Agente único + tools (padrão T1/T2), sem router por trilha. Duas tools novas (`abrir_chamado`, `indicar_profissional`) em `agents/tenant-tools.ts`. Pipeline determinístico de mídia (zero LLM) inserido em `flows/tenant/index.ts` antes do agente — anexa foto a chamado `open`/`acknowledged` existente, ou encaminha ao owner quando não há chamado e a foto chega sem texto; com texto, os `mediaUrls` pendentes ficam disponíveis para a tool `abrir_chamado` anexar na criação. `docs/lei-inquilinato-resumo.md` injetado no contexto do agente (sempre — sem router de trilha para condicionar). A responsabilidade (tenant/owner/unclear) do chamado é decidida pelo próprio LLM (tem lei-resumo + contrato no contexto) e passada como parâmetro da tool — código só valida o enum.

**Tech Stack:** Bun, TypeScript, Fastify, Prisma, LangChain tools (`@langchain/core/tools`) + Zod, React 19 + TanStack Query/Router, Supabase (Postgres + Storage), Tailwind v4 + tailwind-variants/tailwind-merge, shadcn/ui.

## Global Constraints

- Usar **bun** (nunca npm/yarn). Nunca Python.
- `bunx tsc --noEmit` limpo em `apps/bot` e `apps/web` ao final de cada task que toca código.
- `bun run check` (bot) e `bunx tsc --noEmit && bun run lint && bunx vitest run` (web) devem ficar 100% verdes antes do PR.
- Nunca commitar em `main`. Branch atual: `feat/tenant-t3-manutencao`. Commits pequenos, um por task.
- RLS das tabelas novas: **inerte** (`CREATE POLICY` sem `ENABLE ROW LEVEL SECURITY`) — mesmo padrão de `Complaint`/`Coordinator` (PR #38 já provou o custo de esquecer isso).
- Named export nos componentes React (nunca `export default`); `tv()`/`twMerge()`; `data-slot`; sem cores hardcoded; sem barrel files novos.
- Storage: reusar o path já gerado por `buffer.ts`/`uploadLeadDocument` no bucket `leads` — nenhum bucket novo, nenhuma mudança em `buffer.ts`/`storage.ts`.
- Toda tool que grava no banco: side effects de notificação/log são best-effort (`.catch(...)`), nunca bloqueiam o retorno da tool ao LLM.

---

### Task 1: Tipos compartilhados — `MaintenanceRequest` e `ServiceProvider`

**Files:**
- Create: `packages/types/src/maintenance-request.ts`
- Create: `packages/types/src/service-provider.ts`
- Modify: `packages/types/src/index.ts`

**Interfaces:**
- Produces: `MaintenanceType`, `MaintenanceResponsibility`, `MaintenanceSeverity`, `MaintenanceStatus`, `MaintenanceRequest`, `ServiceProviderType`, `ServiceProvider` — usados por todas as tasks seguintes (bot tools, rotas admin, web).

- [ ] **Step 1: Criar `packages/types/src/maintenance-request.ts`**

```typescript
export type MaintenanceType = 'eletrica' | 'hidraulica' | 'civil' | 'limpeza_conservacao';
export type MaintenanceResponsibility = 'tenant' | 'owner' | 'unclear';
export type MaintenanceSeverity = 'baixa' | 'media' | 'urgente';
export type MaintenanceStatus = 'open' | 'acknowledged' | 'in_progress' | 'resolved';

export interface MaintenanceRequest {
  id: string;
  ownerId: string;
  tenantId: string;
  propertyId: string;
  type: MaintenanceType;
  responsibility: MaintenanceResponsibility;
  severity: MaintenanceSeverity;
  summary: string;
  status: MaintenanceStatus;
  mediaUrls: string[];
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Criar `packages/types/src/service-provider.ts`**

```typescript
export type ServiceProviderType = 'eletrica' | 'hidraulica' | 'civil' | 'limpeza_conservacao';

export interface ServiceProvider {
  id: string;
  ownerId: string;
  name: string;
  phone: string;
  type: ServiceProviderType;
  active: boolean;
  createdAt: string;
}
```

- [ ] **Step 3: Exportar em `packages/types/src/index.ts`**

Adicionar, respeitando a ordem alfabética já usada no arquivo:

```typescript
export * from './maintenance-request';
export * from './service-provider';
```

(ficam entre `export * from './lead';` e `export * from './property';`, ordem alfabética como o resto do arquivo)

- [ ] **Step 4: Verificar**

Run: `cd apps/bot && bunx tsc --noEmit && cd ../web && bunx tsc --noEmit`
Expected: PASS (nenhum consumidor ainda usa os tipos novos, então só confirma que o pacote compila).

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/maintenance-request.ts packages/types/src/service-provider.ts packages/types/src/index.ts
git commit -m "feat(types): add MaintenanceRequest and ServiceProvider shared types"
```

---

### Task 2: Migration — models `MaintenanceRequest` + `ServiceProvider` (RLS inerte)

**Files:**
- Modify: `apps/bot/prisma/schema.prisma`
- Create: `apps/bot/prisma/migrations/20260729010000_maintenance_service_provider/migration.sql`

**Interfaces:**
- Consumes: nenhum código anterior — é a base de dados para as tasks 4-10.
- Produces: tabelas `MaintenanceRequest` e `ServiceProvider` no Postgres, acessíveis via `prisma.maintenanceRequest.*` e `prisma.serviceProvider.*`.

- [ ] **Step 1: Adicionar os models em `apps/bot/prisma/schema.prisma`**

Inserir logo após o model `Complaint` (linha ~217 na versão atual):

```prisma
model MaintenanceRequest {
  id             String   @id @default(uuid())
  ownerId        String
  owner          Owner    @relation(fields: [ownerId], references: [id], onDelete: Restrict)
  tenantId       String
  tenant         Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  propertyId     String
  property       Property @relation(fields: [propertyId], references: [id], onDelete: Restrict)
  type           String   // eletrica | hidraulica | civil | limpeza_conservacao
  responsibility String   // tenant | owner | unclear
  severity       String   // baixa | media | urgente
  summary        String
  status         String   @default("open") // open | acknowledged | in_progress | resolved
  mediaUrls      String[] @default([])
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([ownerId])
  @@index([tenantId])
}

model ServiceProvider {
  id        String   @id @default(uuid())
  ownerId   String
  owner     Owner    @relation(fields: [ownerId], references: [id], onDelete: Restrict)
  name      String
  phone     String
  type      String   // eletrica | hidraulica | civil | limpeza_conservacao
  active    Boolean  @default(true)
  createdAt DateTime @default(now())

  @@index([ownerId])
}
```

Adicionar as relações reversas nos models existentes:
- `Owner` (perto de `complaints Complaint[]`): `maintenanceRequests MaintenanceRequest[]` e `serviceProviders ServiceProvider[]`
- `Tenant` (perto de `complaints Complaint[]`): `maintenanceRequests MaintenanceRequest[]`
- `Property` (procurar o model `Property`, perto de outras relações reversas tipo `payments Payment[]`): `maintenanceRequests MaintenanceRequest[]`

- [ ] **Step 2: Escrever a migration à mão**

`prisma migrate dev --create-only` não funciona neste repo (P3006 no shadow-db — já documentado em `docs/superpowers/plans/2026-07-18-lead-conversion-and-login-fixes.md`). Criar o arquivo manualmente, mesmo padrão da migration `20260729000000_complaint`:

`apps/bot/prisma/migrations/20260729010000_maintenance_service_provider/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "MaintenanceRequest" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "responsibility" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "mediaUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceProvider" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceProvider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenanceRequest_ownerId_idx" ON "MaintenanceRequest"("ownerId");

-- CreateIndex
CREATE INDEX "MaintenanceRequest_tenantId_idx" ON "MaintenanceRequest"("tenantId");

-- CreateIndex
CREATE INDEX "ServiceProvider_ownerId_idx" ON "ServiceProvider"("ownerId");

-- AddForeignKey
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceProvider" ADD CONSTRAINT "ServiceProvider_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RowLevelSecurity (created but not enabled globally — see PR #29 / docs/adrs/001-rls-strategy.md)
CREATE POLICY "select_own_rows" ON "MaintenanceRequest"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "select_own_rows" ON "ServiceProvider"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");
```

- [ ] **Step 3: Aplicar a migration e regenerar o client**

Run:
```bash
cd apps/bot
bunx prisma db execute --file prisma/migrations/20260729010000_maintenance_service_provider/migration.sql --schema prisma/schema.prisma
bunx prisma migrate resolve --applied 20260729010000_maintenance_service_provider
bunx prisma generate
```
Expected: sem erros; `bunx prisma validate` também limpo.

- [ ] **Step 4: Verificar**

Run: `cd apps/bot && bunx tsc --noEmit`
Expected: PASS (`prisma.maintenanceRequest` e `prisma.serviceProvider` já tipados no client gerado).

- [ ] **Step 5: Commit**

```bash
git add apps/bot/prisma/schema.prisma apps/bot/prisma/migrations/20260729010000_maintenance_service_provider
git commit -m "feat(db): add MaintenanceRequest and ServiceProvider models (RLS inert)"
```

---

### Task 3: `docs/lei-inquilinato-resumo.md` (rascunho)

**Files:**
- Create: `docs/lei-inquilinato-resumo.md`

**Interfaces:**
- Produces: arquivo estático lido pela Task 7 (`agents/tenant-v2.ts`) e injetado no contexto do agente.

- [ ] **Step 1: Escrever o rascunho**

`docs/lei-inquilinato-resumo.md`:

```markdown
# Resumo — Lei do Inquilinato (Lei 8.245/1991) — responsabilidade por manutenção

> Rascunho para revisão do Fred antes do merge. Uso interno do bot — nunca citar artigo de lei ao inquilino, só a conclusão prática.

## Regra geral

- **Proprietário**: estrutura do imóvel, instalações elétricas/hidráulicas embutidas, itens que falham por desgaste natural ou vício pré-existente, reparos necessários para manter o imóvel habitável (art. 22).
- **Inquilino**: pequenos reparos de manutenção/uso do dia a dia, danos causados por mau uso ou negligência do próprio inquilino, itens que ele mesmo instalou (art. 23).

## Guia rápido por tipo

| Tipo | Geralmente proprietário | Geralmente inquilino |
|---|---|---|
| Elétrica | Fiação embutida, quadro de disjuntores, curto-circuito de instalação | Lâmpada queimada, tomada danificada por aparelho do inquilino |
| Hidráulica | Cano furado na parede, infiltração estrutural, aquecedor de passagem com defeito de fábrica | Entupimento por uso, vedante de torneira gasto, chuveiro elétrico trocado pelo inquilino |
| Civil | Rachadura estrutural, infiltração de laje, porta/janela empenada por desgaste do imóvel | Buraco em parede feito pelo inquilino, dano por móvel mal instalado |
| Limpeza/conservação | Dedetização inicial, limpeza de caixa d'água (se prevista em contrato) | Limpeza rotineira, manutenção de jardim (se não houver jardineiro contratado) |

## Quando marcar como "unclear"

Sempre que o relato do inquilino não permitir distinguir desgaste natural de mau uso, ou quando o item não está listado acima — nunca decidir sozinho nesse caso, deixar o chamado como `unclear` para o proprietário avaliar.
```

- [ ] **Step 2: Commit**

```bash
git add docs/lei-inquilinato-resumo.md
git commit -m "docs: draft lei-inquilinato-resumo.md for tenant maintenance tool (pending Fred review)"
```

---

### Task 4: Tool `abrir_chamado` (TDD)

**Files:**
- Modify: `apps/bot/src/agents/tenant-tools.ts`
- Modify: `apps/bot/src/__tests__/tenant-tools.test.ts`

**Interfaces:**
- Consumes: `prisma.maintenanceRequest.create`, `notifyOwner`, `logActivity` (já existentes).
- Produces: `TenantToolDeps` ganha `propertyId: string` e `pendingMediaUrls: string[]`; tool `abrir_chamado` com schema `{ tipo: MaintenanceType; severidade: MaintenanceSeverity; resumo: string; responsabilidade: MaintenanceResponsibility }`. Task 7/8 dependem desses nomes de campo exatamente.

- [ ] **Step 1: Escrever os testes que falham**

Primeiro, atualizar o fixture `deps` já existente no arquivo (usado por `escalar_owner`/`registrar_reclamacao`) para incluir os dois campos novos de `TenantToolDeps` — senão o arquivo para de compilar assim que a interface mudar no Step 3:

```typescript
const deps = {
  chatId: '5511999999999@s.whatsapp.net',
  tenantId: 'tenant-1',
  ownerId: 'owner-1',
  tenantName: 'Maria',
  propertyId: 'property-1',
  pendingMediaUrls: [] as string[],
};
```

Depois, dentro do mock de `@/db/client` (função `mock.module('@/db/client', ...)`), acrescentar `maintenanceRequest.create` ao objeto `prisma` mockado:

```typescript
const maintenanceCreates: Array<Record<string, unknown>> = [];
const maintenanceUpdates: Array<{ id: string; data: Record<string, unknown> }> = [];
// ... dentro do mock.module('@/db/client', () => ({ prisma: { ... } })), adicionar:
    maintenanceRequest: {
      create: async (args: { data: Record<string, unknown> }) => {
        maintenanceCreates.push(args.data);
        return {
          id: 'maintenance-1',
          ...args.data,
          status: 'open',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      },
    },
```

E ao final do arquivo, antes do `describe('lista completa', ...)`:

```typescript
const depsWithMedia = { ...deps, propertyId: 'property-1', pendingMediaUrls: ['leads/5511999999999/123.jpg'] };

function getToolWithMedia(name: string) {
  const t = buildTenantTools(depsWithMedia).find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} não encontrada`);
  return t;
}

describe('abrir_chamado', () => {
  beforeEach(() => {
    maintenanceCreates.length = 0;
    notifyCalls.length = 0;
    activityLogs.length = 0;
  });

  it('cria o chamado com mediaUrls pendentes e não notifica quando é tenant + severidade baixa', async () => {
    const out = (await getToolWithMedia('abrir_chamado').invoke({
      tipo: 'eletrica',
      severidade: 'baixa',
      resumo: 'Lâmpada queimada na sala',
      responsabilidade: 'tenant',
    })) as string;

    expect(maintenanceCreates).toHaveLength(1);
    expect(maintenanceCreates[0]).toMatchObject({
      ownerId: 'owner-1',
      tenantId: 'tenant-1',
      propertyId: 'property-1',
      type: 'eletrica',
      severity: 'baixa',
      responsibility: 'tenant',
      summary: 'Lâmpada queimada na sala',
      mediaUrls: ['leads/5511999999999/123.jpg'],
    });
    expect(notifyCalls).toHaveLength(0);
    expect(activityLogs[0]).toMatchObject({ action: 'maintenance_request_created', subjectId: 'maintenance-1' });
    expect(out).toContain('registrado');
  });

  it('notifica o owner quando responsabilidade é owner', async () => {
    await getTool('abrir_chamado').invoke({
      tipo: 'hidraulica',
      severidade: 'media',
      resumo: 'Vazamento sob a pia',
      responsabilidade: 'owner',
    });
    expect(notifyCalls[0]?.eventType).toBe('tenant_maintenance_request');
    expect(notifyCalls[0]?.payload).toMatchObject({ responsibility: 'owner' });
  });

  it('notifica o owner quando responsabilidade é unclear', async () => {
    await getTool('abrir_chamado').invoke({
      tipo: 'civil',
      severidade: 'media',
      resumo: 'Rachadura na parede, causa incerta',
      responsabilidade: 'unclear',
    });
    expect(notifyCalls[0]?.eventType).toBe('tenant_maintenance_request');
  });

  it('notifica o owner quando severidade é urgente, mesmo com responsabilidade tenant', async () => {
    await getTool('abrir_chamado').invoke({
      tipo: 'hidraulica',
      severidade: 'urgente',
      resumo: 'Cano estourou, água alagando o quarto',
      responsabilidade: 'tenant',
    });
    expect(notifyCalls[0]?.eventType).toBe('tenant_maintenance_request');
  });

  it('sem mediaUrls pendentes, cria o chamado com array vazio', async () => {
    await getTool('abrir_chamado').invoke({
      tipo: 'limpeza_conservacao',
      severidade: 'baixa',
      resumo: 'Caixa d\'água precisa de limpeza',
      responsabilidade: 'owner',
    });
    expect(maintenanceCreates[0]?.mediaUrls).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd apps/bot && bun test src/__tests__/tenant-tools.test.ts`
Expected: FAIL — `abrir_chamado` tool not found / `deps.propertyId` undefined.

- [ ] **Step 3: Implementar**

Em `apps/bot/src/agents/tenant-tools.ts`, atualizar a interface e adicionar a tool:

```typescript
import type { MaintenanceResponsibility, MaintenanceSeverity, MaintenanceType } from '@kit-manager/types';

export interface TenantToolDeps {
  chatId: string;
  tenantId: string;
  ownerId: string;
  tenantName: string | null;
  propertyId: string;
  pendingMediaUrls: string[];
}

const MAINTENANCE_TYPES: MaintenanceType[] = ['eletrica', 'hidraulica', 'civil', 'limpeza_conservacao'];
const MAINTENANCE_SEVERITIES: MaintenanceSeverity[] = ['baixa', 'media', 'urgente'];
const MAINTENANCE_RESPONSIBILITIES: MaintenanceResponsibility[] = ['tenant', 'owner', 'unclear'];
```

E, dentro de `buildTenantTools`, antes do `return [...]`:

```typescript
  const abrirChamado = tool(
    async ({
      tipo,
      severidade,
      resumo,
      responsabilidade,
    }: {
      tipo: MaintenanceType;
      severidade: MaintenanceSeverity;
      resumo: string;
      responsabilidade: MaintenanceResponsibility;
    }) => {
      try {
        const request = await prisma.maintenanceRequest.create({
          data: {
            ownerId: deps.ownerId,
            tenantId: deps.tenantId,
            propertyId: deps.propertyId,
            type: tipo,
            severity: severidade,
            responsibility: responsabilidade,
            summary: resumo,
            mediaUrls: deps.pendingMediaUrls,
          },
        });
        const displayName = deps.tenantName ?? deps.chatId;
        if (responsabilidade !== 'tenant' || severidade === 'urgente') {
          notifyOwner(deps.ownerId, 'tenant_maintenance_request', {
            tenantName: displayName,
            tenantPhone: deps.chatId,
            summary: resumo,
            responsibility: responsabilidade,
            severity: severidade,
          }).catch((err) => logger.error({ err }, '[tenant-tools] notifyOwner tenant_maintenance_request falhou'));
        }
        logActivity({
          ownerId: deps.ownerId,
          actorType: 'bot',
          actorLabel: 'Bot',
          action: 'maintenance_request_created',
          subjectType: 'maintenance_request',
          subjectId: request.id,
          subject: displayName,
          metadata: { type: tipo, severity: severidade, responsibility: responsabilidade },
        }).catch((err) => logger.error({ err }, '[tenant-tools] logActivity maintenance_request_created falhou'));
        return 'Chamado registrado com sucesso.';
      } catch (err) {
        logger.error({ err }, '[tenant-tools] abrir_chamado');
        return fail('não consegui registrar o chamado agora.');
      }
    },
    {
      name: 'abrir_chamado',
      description:
        'Abre um chamado de manutenção. tipo: eletrica, hidraulica, civil ou limpeza_conservacao. ' +
        'severidade: baixa, media ou urgente (risco imediato ao imóvel/segurança, mas NÃO emergência de vida — ' +
        'isso já é tratado antes de você ser chamado). responsabilidade: use o resumo da Lei do Inquilinato ' +
        'e o contrato, já disponíveis no seu contexto, para decidir entre tenant (uso/desgaste do dia a dia), ' +
        'owner (estrutura, desgaste natural, vício do imóvel) ou unclear quando o relato não permitir distinguir — ' +
        'nunca decida um caso ambíguo como tenant só para simplificar.',
      schema: z.object({
        tipo: z.enum(MAINTENANCE_TYPES as [MaintenanceType, ...MaintenanceType[]]),
        severidade: z.enum(MAINTENANCE_SEVERITIES as [MaintenanceSeverity, ...MaintenanceSeverity[]]),
        resumo: z.string(),
        responsabilidade: z.enum(MAINTENANCE_RESPONSIBILITIES as [MaintenanceResponsibility, ...MaintenanceResponsibility[]]),
      }),
    },
  );
```

Atualizar o `return` final de `buildTenantTools` para incluir `abrirChamado` (a tool `indicarProfissional` entra na Task 5).

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd apps/bot && bun test src/__tests__/tenant-tools.test.ts`
Expected: PASS (o teste `describe('lista completa', ...)` vai quebrar até a Task 5 atualizar a lista esperada de nomes — ok por ora, ajustado no Step 5 da Task 5).

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/agents/tenant-tools.ts apps/bot/src/__tests__/tenant-tools.test.ts
git commit -m "feat(tenant): add abrir_chamado tool"
```

---

### Task 5: Tool `indicar_profissional` (TDD)

**Files:**
- Modify: `apps/bot/src/agents/tenant-tools.ts`
- Modify: `apps/bot/src/__tests__/tenant-tools.test.ts`

**Interfaces:**
- Consumes: `prisma.serviceProvider.findFirst`.
- Produces: tool `indicar_profissional` com schema `{ tipo: MaintenanceType }`.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar `serviceProvider.findFirst` ao mock de `@/db/client`:

```typescript
const serviceProviders: Array<Record<string, unknown>> = [];
// dentro do prisma mockado:
    serviceProvider: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        return (
          serviceProviders.find(
            (p) => p.ownerId === args.where.ownerId && p.type === args.where.type && p.active === true,
          ) ?? null
        );
      },
    },
```

E adicionar o describe block:

```typescript
describe('indicar_profissional', () => {
  beforeEach(() => {
    serviceProviders.length = 0;
  });

  it('retorna nome e telefone do profissional ativo', async () => {
    serviceProviders.push({
      id: 'sp-1',
      ownerId: 'owner-1',
      name: 'João Elétrica',
      phone: '11955554444',
      type: 'eletrica',
      active: true,
    });
    const out = (await getTool('indicar_profissional').invoke({ tipo: 'eletrica' })) as string;
    expect(out).toContain('João Elétrica');
    expect(out).toContain('11955554444');
  });

  it('sem profissional cadastrado, responde honestamente', async () => {
    const out = (await getTool('indicar_profissional').invoke({ tipo: 'hidraulica' })) as string;
    expect(out.toLowerCase()).toContain('não há profissional');
  });
});

describe('lista completa', () => {
  it('expõe as 4 tools da T1-T3', () => {
    const names = buildTenantTools(deps).map((t) => t.name);
    expect(names).toEqual(['escalar_owner', 'registrar_reclamacao', 'abrir_chamado', 'indicar_profissional']);
  });
});
```

Remover o `describe('lista completa', ...)` antigo (2 tools) da Task anterior — este substitui.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd apps/bot && bun test src/__tests__/tenant-tools.test.ts`
Expected: FAIL — `indicar_profissional` tool not found.

- [ ] **Step 3: Implementar**

Em `apps/bot/src/agents/tenant-tools.ts`, adicionar antes do `return`:

```typescript
  const indicarProfissional = tool(
    async ({ tipo }: { tipo: MaintenanceType }) => {
      try {
        const provider = await prisma.serviceProvider.findFirst({
          where: { ownerId: deps.ownerId, type: tipo, active: true },
          orderBy: { createdAt: 'asc' },
        });
        if (!provider) {
          return 'Não há profissional cadastrado para esse tipo de serviço no momento.';
        }
        return `Profissional indicado: ${provider.name} — ${provider.phone}.`;
      } catch (err) {
        logger.error({ err }, '[tenant-tools] indicar_profissional');
        return fail('não consegui consultar os profissionais agora.');
      }
    },
    {
      name: 'indicar_profissional',
      description:
        'Indica um profissional cadastrado (eletricista, encanador, pedreiro, diarista) para o tipo de serviço. ' +
        'Use quando o problema for responsabilidade do inquilino (já deu a dica de resolver sozinho) ou o ' +
        'inquilino pedir uma indicação. Se não houver cadastrado, diga isso honestamente — nunca invente um nome.',
      schema: z.object({ tipo: z.enum(MAINTENANCE_TYPES as [MaintenanceType, ...MaintenanceType[]]) }),
    },
  );

  return [escalarOwner, registrarReclamacao, abrirChamado, indicarProfissional];
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd apps/bot && bun test src/__tests__/tenant-tools.test.ts`
Expected: PASS — todos os describes, incluindo `lista completa` com as 4 tools.

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/agents/tenant-tools.ts apps/bot/src/__tests__/tenant-tools.test.ts
git commit -m "feat(tenant): add indicar_profissional tool"
```

---

### Task 6: `notify.ts` — templates `tenant_maintenance_request` e `tenant_media_forwarded` (TDD)

**Files:**
- Modify: `apps/bot/src/services/notify.ts`
- Modify: `apps/bot/src/__tests__/notify-tenant.test.ts`

**Interfaces:**
- Produces: `buildTenantMaintenanceRequestMessage(payload)`, `buildTenantMediaForwardedMessage(payload)` — a Task 4 já assume o eventType `tenant_maintenance_request`; a Task 8 assume `tenant_media_forwarded`.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar em `apps/bot/src/__tests__/notify-tenant.test.ts`:

```typescript
import {
  buildTenantMaintenanceRequestMessage,
  buildTenantMediaForwardedMessage,
} from '@/services/notify';

describe('buildTenantMaintenanceRequestMessage', () => {
  test('inclui nome, telefone, resumo, responsabilidade e severidade', () => {
    const msg = buildTenantMaintenanceRequestMessage({
      tenantName: 'Carlos Nunes',
      tenantPhone: '11944443333',
      summary: 'Vazamento sob a pia da cozinha',
      responsibility: 'owner',
      severity: 'media',
    });
    expect(msg).toContain('Carlos Nunes');
    expect(msg).toContain('11944443333');
    expect(msg).toContain('Vazamento sob a pia da cozinha');
    expect(msg.toLowerCase()).toContain('proprietário');
  });
});

describe('buildTenantMediaForwardedMessage', () => {
  test('inclui nome e telefone', () => {
    const msg = buildTenantMediaForwardedMessage({
      tenantName: 'Paula Reis',
      tenantPhone: '11933332222',
    });
    expect(msg).toContain('Paula Reis');
    expect(msg).toContain('11933332222');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd apps/bot && bun test src/__tests__/notify-tenant.test.ts`
Expected: FAIL — funções não existem.

- [ ] **Step 3: Implementar**

Em `apps/bot/src/services/notify.ts`, adicionar ao `NotifyPayloadMap`:

```typescript
  tenant_maintenance_request: {
    tenantName: string;
    tenantPhone: string;
    summary: string;
    responsibility: 'tenant' | 'owner' | 'unclear';
    severity: 'baixa' | 'media' | 'urgente';
  };
  tenant_media_forwarded: { tenantName: string; tenantPhone: string };
```

Adicionar os cases no `switch` de `buildChannelContent`:

```typescript
    case 'tenant_maintenance_request': {
      const p = payload as NotifyPayloadMap['tenant_maintenance_request'];
      return { whatsapp: buildTenantMaintenanceRequestMessage(p), email: null };
    }
    case 'tenant_media_forwarded': {
      const p = payload as NotifyPayloadMap['tenant_media_forwarded'];
      return { whatsapp: buildTenantMediaForwardedMessage(p), email: null };
    }
```

E as funções exportadas (perto de `buildTenantComplaintMessage`):

```typescript
const RESPONSIBILITY_LABEL: Record<'tenant' | 'owner' | 'unclear', string> = {
  tenant: 'inquilino',
  owner: 'proprietário',
  unclear: 'indefinida',
};

export function buildTenantMaintenanceRequestMessage(payload: {
  tenantName: string;
  tenantPhone: string;
  summary: string;
  responsibility: 'tenant' | 'owner' | 'unclear';
  severity: 'baixa' | 'media' | 'urgente';
}): string {
  return (
    `🔧 Novo chamado de manutenção\n` +
    `Inquilino: ${payload.tenantName} (${payload.tenantPhone})\n` +
    `Resumo: ${payload.summary}\n` +
    `Responsabilidade sugerida: ${RESPONSIBILITY_LABEL[payload.responsibility]}\n` +
    `Severidade: ${payload.severity}\n` +
    `Acesse o painel para ver os detalhes.`
  );
}

export function buildTenantMediaForwardedMessage(payload: {
  tenantName: string;
  tenantPhone: string;
}): string {
  return (
    `📎 Inquilino enviou uma foto sem chamado aberto\n` +
    `Inquilino: ${payload.tenantName} (${payload.tenantPhone})\n` +
    `Acesse o painel para ver o arquivo recebido.`
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd apps/bot && bun test src/__tests__/notify-tenant.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/services/notify.ts apps/bot/src/__tests__/notify-tenant.test.ts
git commit -m "feat(notify): add tenant_maintenance_request and tenant_media_forwarded templates"
```

---

### Task 7: Prompt do agente — injeta lei-resumo + habilita as tools novas

**Files:**
- Modify: `apps/bot/src/agents/tenant-v2.ts`
- Modify: `apps/bot/src/flows/tenant/context.ts` (adicionar leitura do arquivo estático)
- Test: `apps/bot/src/flows/tenant/__tests__/context.test.ts`

**Interfaces:**
- Consumes: `docs/lei-inquilinato-resumo.md` (Task 3).
- Produces: `renderTenantContext(snapshot)` passa a incluir o resumo da lei ao final do contexto; `runTenantAgentV2` ganha instruções de prompt para as tools de manutenção.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/bot/src/flows/tenant/__tests__/context.test.ts`, adicionar (mantendo os testes existentes):

```typescript
it('renderTenantContext inclui o resumo da lei do inquilinato', () => {
  const snapshot = buildFakeSnapshot(); // usar o helper já existente no arquivo para montar um TenantSnapshot válido
  const rendered = renderTenantContext(snapshot);
  expect(rendered).toContain('Lei do Inquilinato');
});
```

(Ajustar o nome do helper de fixture para o que já existir no arquivo — conferir o topo de `context.test.ts` antes de escrever este passo; se não houver helper, montar o objeto `TenantSnapshot` inline como os outros testes do arquivo já fazem.)

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd apps/bot && bun test src/flows/tenant/__tests__/context.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Em `apps/bot/src/flows/tenant/context.ts`, adicionar no topo:

```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let cachedMaintenanceLawSummary: string | null = null;

function getMaintenanceLawSummary(): string {
  if (cachedMaintenanceLawSummary !== null) return cachedMaintenanceLawSummary;
  try {
    cachedMaintenanceLawSummary = readFileSync(
      join(process.cwd(), 'docs', 'lei-inquilinato-resumo.md'),
      'utf-8',
    );
  } catch {
    cachedMaintenanceLawSummary = '';
  }
  return cachedMaintenanceLawSummary;
}
```

E, ao final de `renderTenantContext`, antes do `return lines.join('\n');`:

```typescript
  const lawSummary = getMaintenanceLawSummary();
  if (lawSummary) {
    lines.push('---', lawSummary);
  }
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd apps/bot && bun test src/flows/tenant/__tests__/context.test.ts`
Expected: PASS.

- [ ] **Step 5: Atualizar o prompt em `agents/tenant-v2.ts`**

Adicionar ao `TENANT_AGENT_V2_PROMPT`, após a linha de `registrar_reclamacao`:

```
- Problema de manutenção (elétrica, hidráulica, civil, limpeza/conservação): chame abrir_chamado com tipo, severidade e um resumo curto. Decida a responsabilidade (tenant/owner/unclear) usando o resumo da Lei do Inquilinato e o contrato do "Contexto do sistema" — nunca marque como tenant só para simplificar um caso ambíguo, use unclear. Depois de abrir o chamado, se for responsabilidade do inquilino, ofereça indicar_profissional.
```

Isso não tem teste unitário próprio (é texto de prompt) — validado pela Task 8 (integração do pipeline) e no smoke test manual antes do merge.

- [ ] **Step 6: Verificar tudo**

Run: `cd apps/bot && bunx tsc --noEmit && bun test src`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/bot/src/flows/tenant/context.ts apps/bot/src/flows/tenant/__tests__/context.test.ts apps/bot/src/agents/tenant-v2.ts
git commit -m "feat(tenant): inject lei-inquilinato summary into agent context and prompt"
```

---

### Task 8: Pipeline determinístico de mídia em `flows/tenant/index.ts` (TDD)

**Files:**
- Modify: `apps/bot/src/flows/tenant/index.ts`
- Modify: `apps/bot/src/flows/tenant/__tests__/index.test.ts`

**Interfaces:**
- Consumes: `prisma.maintenanceRequest.findFirst/update`, `buildTenantTools` com `propertyId`/`pendingMediaUrls` (Task 4).
- Produces: branch novo no orquestrador — não muda a assinatura de `handleTenantMessage`.

- [ ] **Step 1: Escrever os testes que falham**

O arquivo hoje mocka `buildTenantTools` como `() => []` (sem capturar os `deps` recebidos) e `runTenantAgentV2` sem registrar chamadas. Atualizar os dois mocks para capturar isso, e adicionar `maintenanceRequest` ao mock de `@/db/client` — mudanças no topo do arquivo, antes do `import { handleTenantMessage } ...`:

```typescript
// junto das outras variáveis de estado no topo do arquivo (perto de `const events = [...]`)
const maintenanceRequests: Array<{ id: string; status: string; createdAt: string }> = [];
const maintenanceUpdates: Array<{ id: string; data: Record<string, unknown> }> = [];
const agentCalls: Array<{ question: string }> = [];
let toolDepsCaptured: { propertyId: string; pendingMediaUrls: string[] } | null = null;

// dentro do objeto `prisma` em mock.module('@/db/client', () => ({ prisma: { ... } })),
// adicionar ao lado de `tenant`, `event`, `conversation`:
    maintenanceRequest: {
      findFirst: async (args: { where: { status: { in: string[] } } }) => {
        const candidates = maintenanceRequests.filter((m) => args.where.status.in.includes(m.status));
        candidates.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return candidates[0] ?? null;
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        maintenanceUpdates.push({ id: args.where.id, data: args.data });
        return {};
      },
    },

// substituir os dois mock.module existentes por estas versões (capturam a chamada):
mock.module('@/agents/tenant-v2', () => ({
  runTenantAgentV2: async (question: string) => {
    agentCalls.push({ question });
    return 'Resposta do agente.';
  },
}));

mock.module('@/agents/tenant-tools', () => ({
  buildTenantTools: (deps: { propertyId: string; pendingMediaUrls: string[] }) => {
    toolDepsCaptured = { propertyId: deps.propertyId, pendingMediaUrls: deps.pendingMediaUrls };
    return [];
  },
}));
```

E, no `beforeEach` do `describe('handleTenantMessage', ...)` já existente, resetar os arrays novos junto dos existentes: `maintenanceRequests.length = 0; maintenanceUpdates.length = 0; agentCalls.length = 0; toolDepsCaptured = null;`.

Depois, os testes novos:

```typescript
it('foto sem texto + chamado open existente → anexa direto, zero LLM', async () => {
  maintenanceRequests.push({ id: 'mr-1', status: 'open', createdAt: '2026-07-01T00:00:00Z' });
  await handleTenantMessage(
    '5511999999999@s.whatsapp.net',
    null,
    [{ type: 'image', mime: 'image/jpeg', url: 'leads/5511999999999/1.jpg' }],
    'owner-1',
    'tenant-1',
    'Maria',
  );
  expect(maintenanceUpdates[0]).toMatchObject({ id: 'mr-1' });
  expect(sentTexts[0]?.text).toContain('anexei');
  expect(agentCalls).toHaveLength(0); // agente não deve ser chamado
});

it('foto sem texto + sem chamado aberto → encaminha ao owner, zero LLM', async () => {
  await handleTenantMessage(
    '5511999999999@s.whatsapp.net',
    null,
    [{ type: 'image', mime: 'image/jpeg', url: 'leads/5511999999999/2.jpg' }],
    'owner-1',
    'tenant-1',
    'Maria',
  );
  expect(notifyCalls.find((c) => c.eventType === 'tenant_media_forwarded')).toBeDefined();
  expect(agentCalls).toHaveLength(0);
});

it('foto COM texto → segue pro agente, mediaUrls disponíveis via deps', async () => {
  await handleTenantMessage(
    '5511999999999@s.whatsapp.net',
    'Tá vazando embaixo da pia',
    [{ type: 'image', mime: 'image/jpeg', url: 'leads/5511999999999/3.jpg' }],
    'owner-1',
    'tenant-1',
    'Maria',
  );
  expect(agentCalls).toHaveLength(1);
  expect(toolDepsCaptured?.pendingMediaUrls).toEqual(['leads/5511999999999/3.jpg']);
});
```

Ajustar os mocks de `@/agents/tenant-tools` e `@/agents/tenant-v2` já existentes no arquivo para capturar as chamadas (`agentCalls`, `toolDepsCaptured`) se ainda não capturarem — conferir o que já existe no topo do arquivo antes de duplicar.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd apps/bot && bun test src/flows/tenant/__tests__/index.test.ts`
Expected: FAIL — branch de mídia não existe ainda.

- [ ] **Step 3: Implementar**

Em `apps/bot/src/flows/tenant/index.ts`, adicionar a constante e a função auxiliar perto de `isAudioMedia`:

```typescript
const MEDIA_FORWARDED_REPLY = 'Recebi, encaminhei ao proprietário.';
const MEDIA_ATTACHED_REPLY = 'Recebi a foto, anexei ao chamado ✅';

function extractMediaUrls(items: MediaItem[]): string[] {
  return items.map((m) => m.url).filter((u): u is string => Boolean(u));
}
```

Inserir o branch novo logo após o bloco de emergência (item 1) e antes da saudação (item 2), renumerando os comentários existentes (`// 2. Greeting` vira `// 3. Greeting`, e assim por diante):

```typescript
    // 2. Non-audio media — deterministic pipeline (design §3, nota T3).
    // Zero LLM: attaches to an already-open chamado, or forwards to the
    // owner when there's nothing to attach to and no text accompanies it.
    // With text present, falls through to the agent (see step 6) with
    // pendingMediaUrls available for abrir_chamado to attach on creation.
    const nonAudioMedia = mediaItems.filter((item) => !isAudioMedia(item));
    if (nonAudioMedia.length > 0 && !messageText) {
      const displayName = tenantName ?? chatId;
      const mediaUrls = extractMediaUrls(nonAudioMedia);
      const openRequest = await prisma.maintenanceRequest.findFirst({
        where: { tenantId, status: { in: ['open', 'acknowledged'] } },
        orderBy: { createdAt: 'desc' },
      });

      if (openRequest) {
        await prisma.maintenanceRequest.update({
          where: { id: openRequest.id },
          data: { mediaUrls: { push: mediaUrls } },
        });
        await persistTurn(chatId, ownerId, null, MEDIA_ATTACHED_REPLY);
        await sendText(chatId, MEDIA_ATTACHED_REPLY);
        return;
      }

      await Promise.allSettled([
        notifyOwner(ownerId, 'tenant_media_forwarded', {
          tenantName: displayName,
          tenantPhone: chatId,
        }).catch((err) => logger.error({ err }, '[tenant.flow] notifyOwner tenant_media_forwarded failed')),
        logActivity({
          ownerId,
          actorType: 'bot',
          actorLabel: 'Bot',
          action: 'tenant_media_forwarded',
          subjectType: 'tenant',
          subjectId: tenantId,
          subject: displayName,
        }).catch((err) => logger.error({ err }, '[tenant.flow] logActivity tenant_media_forwarded failed')),
        persistTurn(chatId, ownerId, null, MEDIA_FORWARDED_REPLY).catch((err) =>
          logger.error({ err, chatId }, '[tenant.flow] persistTurn falhou no forward de mídia'),
        ),
        sendText(chatId, MEDIA_FORWARDED_REPLY).catch((err) =>
          logger.error({ err, chatId }, '[tenant.flow] sendText falhou no forward de mídia'),
        ),
      ]);
      return;
    }
```

E, no branch do agente (antigo item 7, onde `buildTenantTools` é chamado), passar os campos novos:

```typescript
    const tools = buildTenantTools({
      chatId,
      tenantId,
      ownerId,
      tenantName,
      propertyId: snapshot.property.id,
      pendingMediaUrls: extractMediaUrls(nonAudioMedia),
    });
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd apps/bot && bun test src/flows/tenant/__tests__/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Rodar a suíte completa do bot**

Run: `cd apps/bot && bun run check`
Expected: PASS — typecheck + lint + `bun test src` 100% verde.

- [ ] **Step 6: Commit**

```bash
git add apps/bot/src/flows/tenant/index.ts apps/bot/src/flows/tenant/__tests__/index.test.ts
git commit -m "feat(tenant): deterministic media pipeline for maintenance photos"
```

---

### Task 9: Endpoints `GET/POST/PATCH /admin/providers`

**Files:**
- Create: `apps/bot/src/routes/admin/providers.ts`
- Modify: `apps/bot/src/routes/admin/index.ts`
- Test: `apps/bot/src/__tests__/providers-routes.test.ts` (conferir se existe um padrão de teste HTTP para rotas admin — se não houver, seguir o mesmo nível de cobertura das rotas de coordinators/complaints, que hoje não têm teste HTTP dedicado; neste caso, pular teste automatizado desta task e cobrir via smoke test manual antes do merge, documentando isso no PR)

**Interfaces:**
- Produces: `GET /admin/providers`, `POST /admin/providers`, `PATCH /admin/providers/:id` — consumidos pela Task 11 (web).

- [ ] **Step 1: Confirmar se rotas admin têm teste HTTP no repo**

Run: `find apps/bot/src -iname "*complaints*test*" -o -iname "*coordinators*test*"`
Se não retornar nenhum arquivo sob `routes/admin`, este padrão de rota não tem cobertura de teste dedicada no projeto — implementar direto e cobrir com verificação manual (`curl`) antes do merge, documentando no PR. Se retornar algum arquivo, seguir o padrão dele para este task.

- [ ] **Step 2: Implementar `apps/bot/src/routes/admin/providers.ts`**

```typescript
import type { ServiceProviderType } from '@kit-manager/types';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/client';
import { verifyAdminJwt } from '@/plugins/admin-auth';
import { logActivity } from '@/services/activity';

const VALID_TYPES: ServiceProviderType[] = ['eletrica', 'hidraulica', 'civil', 'limpeza_conservacao'];

export async function providersRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/admin/providers', { preHandler: verifyAdminJwt }, async (_request, reply) => {
    const providers = await prisma.serviceProvider.findMany({ orderBy: { createdAt: 'asc' } });
    return reply.send(providers);
  });

  fastify.post<{ Body: { name: string; phone: string; type: ServiceProviderType } }>(
    '/admin/providers',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { name, phone, type } = request.body;
      if (!name) return reply.status(400).send({ error: 'name is required' });
      if (!phone) return reply.status(400).send({ error: 'phone is required' });
      if (!VALID_TYPES.includes(type)) {
        return reply.status(400).send({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
      }
      const owner = await prisma.owner.findFirst();
      if (!owner) return reply.status(400).send({ error: 'No owner found' });
      const provider = await prisma.serviceProvider.create({
        data: { name, phone, type, ownerId: owner.id },
      });
      await logActivity({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: provider.ownerId,
        action: 'provider_created',
        subject: provider.name,
        subjectId: provider.id,
        subjectType: 'service_provider',
      }).catch(fastify.log.warn.bind(fastify.log));
      return reply.status(201).send(provider);
    },
  );

  fastify.patch<{
    Params: { id: string };
    Body: { name?: string; phone?: string; type?: ServiceProviderType; active?: boolean };
  }>('/admin/providers/:id', { preHandler: verifyAdminJwt }, async (request, reply) => {
    const { id } = request.params;
    const { name, phone, type, active } = request.body;
    if (name !== undefined && !name) return reply.status(400).send({ error: 'name cannot be empty' });
    if (phone !== undefined && !phone) return reply.status(400).send({ error: 'phone cannot be empty' });
    if (type !== undefined && !VALID_TYPES.includes(type)) {
      return reply.status(400).send({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
    }
    const existing = await prisma.serviceProvider.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return reply.status(404).send({ error: 'Provider not found' });
    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (phone !== undefined) data.phone = phone;
    if (type !== undefined) data.type = type;
    if (active !== undefined) data.active = active;
    const provider = await prisma.serviceProvider.update({ where: { id }, data });
    await logActivity({
      actorType: 'user',
      actorId: request.adminUserId ?? undefined,
      actorLabel: request.adminUserId ?? 'admin',
      ownerId: provider.ownerId,
      action: 'provider_updated',
      subject: provider.name,
      subjectId: provider.id,
      subjectType: 'service_provider',
      metadata: { active },
    }).catch(fastify.log.warn.bind(fastify.log));
    return reply.send(provider);
  });
}
```

- [ ] **Step 3: Registrar em `apps/bot/src/routes/admin/index.ts`**

```typescript
import { providersRoutes } from './providers';
// ...
  await providersRoutes(fastify);
```

- [ ] **Step 4: Verificar**

Run: `cd apps/bot && bunx tsc --noEmit && bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/routes/admin/providers.ts apps/bot/src/routes/admin/index.ts
git commit -m "feat(admin): add GET/POST/PATCH /admin/providers endpoints"
```

---

### Task 10: Endpoint `PATCH /admin/maintenance/:id`

**Files:**
- Create: `apps/bot/src/routes/admin/maintenance.ts`
- Modify: `apps/bot/src/routes/admin/index.ts`

**Interfaces:**
- Produces: `PATCH /admin/maintenance/:id` (mesmo shape de `PATCH /admin/complaints/:id`, com `in_progress` a mais no enum).

- [ ] **Step 1: Implementar `apps/bot/src/routes/admin/maintenance.ts`**

```typescript
import type { MaintenanceStatus } from '@kit-manager/types';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/client';
import { verifyAdminJwt } from '@/plugins/admin-auth';
import { logActivity } from '@/services/activity';

const VALID_STATUSES: MaintenanceStatus[] = ['open', 'acknowledged', 'in_progress', 'resolved'];

export async function maintenanceRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.patch<{ Params: { id: string }; Body: { status: MaintenanceStatus } }>(
    '/admin/maintenance/:id',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { status } = request.body;
      if (!VALID_STATUSES.includes(status)) {
        return reply.status(400).send({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      }
      const existing = await prisma.maintenanceRequest.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ error: 'Maintenance request not found' });
      const request_ = await prisma.maintenanceRequest.update({ where: { id }, data: { status } });
      await logActivity({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: request_.ownerId,
        action: 'maintenance_status_changed',
        subject: request_.summary,
        subjectId: request_.id,
        subjectType: 'maintenance_request',
        metadata: { status },
      }).catch(fastify.log.warn.bind(fastify.log));
      return reply.send(request_);
    },
  );
}
```

- [ ] **Step 2: Registrar em `apps/bot/src/routes/admin/index.ts`**

```typescript
import { maintenanceRoutes } from './maintenance';
// ...
  await maintenanceRoutes(fastify);
```

- [ ] **Step 3: Verificar**

Run: `cd apps/bot && bunx tsc --noEmit && bun run lint && bun run test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/bot/src/routes/admin/maintenance.ts apps/bot/src/routes/admin/index.ts
git commit -m "feat(admin): add PATCH /admin/maintenance/:id endpoint"
```

---

### Task 11: Web — `lib/queries.ts` e `lib/api.ts`

**Files:**
- Modify: `apps/web/src/lib/queries.ts`
- Modify: `apps/web/src/lib/api.ts`

**Interfaces:**
- Consumes: bucket `leads` via `supabase.storage` (mesmo padrão de `fetchTenantDocuments`).
- Produces: `fetchServiceProviders()`, `fetchTenantMaintenanceRequests(tenantId)` — usados nas Tasks 12/13.

- [ ] **Step 1: Adicionar em `apps/web/src/lib/queries.ts`**

No topo, ajustar o import de tipos (adicionar `MaintenanceRequest`, `ServiceProvider` ao bloco de import de `@kit-manager/types` já existente). Depois de `fetchTenantComplaints`:

```typescript
export async function fetchServiceProviders(): Promise<ServiceProvider[]> {
  const { data, error } = await supabase
    .from('ServiceProvider')
    .select('*')
    .order('createdAt', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ServiceProvider[];
}

export async function fetchTenantMaintenanceRequests(tenantId: string): Promise<MaintenanceRequest[]> {
  const { data, error } = await supabase
    .from('MaintenanceRequest')
    .select('*')
    .eq('tenantId', tenantId)
    .order('createdAt', { ascending: false });
  if (error) throw error;

  const rawRequests = (data ?? []) as MaintenanceRequest[];
  return Promise.all(
    rawRequests.map(async (req) => {
      if (req.mediaUrls.length === 0) return req;
      const signedUrls = await Promise.all(
        req.mediaUrls.map(async (path) => {
          const { data: signed, error: signErr } = await supabase.storage
            .from('leads')
            .createSignedUrl(path, 3600);
          if (signErr) {
            console.error(`[fetchTenantMaintenanceRequests] Failed to sign URL for ${path}:`, signErr);
            return path;
          }
          return signed.signedUrl;
        }),
      );
      return { ...req, mediaUrls: signedUrls };
    }),
  );
}
```

- [ ] **Step 2: Adicionar em `apps/web/src/lib/api.ts`**

Ajustar o import de tipos no topo (adicionar `MaintenanceStatus`). Depois de `updateComplaintStatus`:

```typescript
  createProvider: (data: { name: string; phone: string; type: string }) =>
    botApi.post('/admin/providers', data),
  updateProvider: (
    id: string,
    data: Partial<{ name: string; phone: string; type: string; active: boolean }>,
  ) => botApi.patch(`/admin/providers/${id}`, data),
  updateMaintenanceStatus: (id: string, status: MaintenanceStatus) =>
    botApi.patch(`/admin/maintenance/${id}`, { status }),
```

- [ ] **Step 3: Verificar**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/queries.ts apps/web/src/lib/api.ts
git commit -m "feat(web): add data-fetching and mutation helpers for providers and maintenance"
```

---

### Task 12: Página `/providers` (TDD no componente da tabela)

**Files:**
- Create: `apps/web/src/routes/_dashboard/providers/index.tsx`
- Create: `apps/web/src/components/provider-form-modal.tsx`
- Test: `apps/web/src/__tests__/provider-form-modal.test.tsx`

**Interfaces:**
- Consumes: `fetchServiceProviders`, `adminApi.createProvider/updateProvider`, `Toggle` (`@/components/ui/toggle`).
- Produces: rota `/providers` registrada no TanStack Router (arquivo gerado automaticamente por `bun run dev`/build — não precisa editar `routeTree.gen.ts` manualmente).

- [ ] **Step 1: Escrever o teste que falha para o modal**

`apps/web/src/__tests__/provider-form-modal.test.tsx`:

```typescript
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { ProviderFormModal } from '@/components/provider-form-modal';

describe('ProviderFormModal', () => {
  test('não renderiza nada quando fechado', () => {
    const { container } = render(
      <ProviderFormModal open={false} onClose={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(container.querySelector('[data-slot="provider-form-modal"]')).not.toBeInTheDocument();
  });

  test('envia nome, telefone e tipo preenchidos', () => {
    const onSubmit = vi.fn();
    render(<ProviderFormModal open onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'João Elétrica' } });
    fireEvent.change(screen.getByLabelText(/telefone/i), { target: { value: '11955554444' } });
    fireEvent.change(screen.getByLabelText(/tipo/i), { target: { value: 'eletrica' } });
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'João Elétrica', phone: '11955554444', type: 'eletrica' });
  });

  test('pré-preenche quando initialValue é passado (edição)', () => {
    render(
      <ProviderFormModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        initialValue={{ name: 'Ana Hidráulica', phone: '11922221111', type: 'hidraulica' }}
      />,
    );
    expect(screen.getByLabelText(/nome/i)).toHaveValue('Ana Hidráulica');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd apps/web && bunx vitest run src/__tests__/provider-form-modal.test.tsx`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `apps/web/src/components/provider-form-modal.tsx`**

```tsx
import { useState } from 'react';
import type { ServiceProviderType } from '@kit-manager/types';
import { CustomButton } from '@/components/ui/btn';

const TYPE_LABEL: Record<ServiceProviderType, string> = {
  eletrica: 'Elétrica',
  hidraulica: 'Hidráulica',
  civil: 'Civil',
  limpeza_conservacao: 'Limpeza/Conservação',
};

export interface ProviderFormValue {
  name: string;
  phone: string;
  type: ServiceProviderType;
}

interface ProviderFormModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (value: ProviderFormValue) => void;
  initialValue?: ProviderFormValue;
}

export function ProviderFormModal({ open, onClose, onSubmit, initialValue }: ProviderFormModalProps) {
  const [name, setName] = useState(initialValue?.name ?? '');
  const [phone, setPhone] = useState(initialValue?.phone ?? '');
  const [type, setType] = useState<ServiceProviderType>(initialValue?.type ?? 'eletrica');

  if (!open) return null;

  return (
    <div data-slot="provider-form-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface-raised p-5">
        <h2 className="mb-4 text-sm font-medium text-foreground">
          {initialValue ? 'Editar prestador' : 'Novo prestador'}
        </h2>
        <div className="space-y-3">
          <label className="block text-xs text-muted-foreground">
            Nome
            <input
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            Telefone
            <input
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            Tipo
            <select
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
              value={type}
              onChange={(e) => setType(e.target.value as ServiceProviderType)}
            >
              {Object.entries(TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <CustomButton variant="ghost" onClick={onClose}>
            Cancelar
          </CustomButton>
          <CustomButton onClick={() => onSubmit({ name, phone, type })}>Salvar</CustomButton>
        </div>
      </div>
    </div>
  );
}
```

(Conferir a API real de `CustomButton` em `apps/web/src/components/ui/btn.tsx` antes deste step — usar a prop de variante que já existir lá; se o componente não aceitar `variant="ghost"`, usar a variante equivalente já suportada.)

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd apps/web && bunx vitest run src/__tests__/provider-form-modal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Implementar a página `apps/web/src/routes/_dashboard/providers/index.tsx`**

```tsx
import type { ServiceProvider } from '@kit-manager/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { ProviderFormModal, type ProviderFormValue } from '@/components/provider-form-modal';
import { CustomButton } from '@/components/ui/btn';
import { Toggle } from '@/components/ui/toggle';
import { adminApi, apiErrorMessage } from '@/lib/api';
import { fetchServiceProviders } from '@/lib/queries';

export const Route = createFileRoute('/_dashboard/providers/')({ component: ProvidersPage });

const TYPE_LABEL: Record<string, string> = {
  eletrica: 'Elétrica',
  hidraulica: 'Hidráulica',
  civil: 'Civil',
  limpeza_conservacao: 'Limpeza/Conservação',
};

function ProvidersPage() {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceProvider | null>(null);

  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['service-providers'],
    queryFn: fetchServiceProviders,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['service-providers'] });

  const createMutation = useMutation({
    mutationFn: (value: ProviderFormValue) => adminApi.createProvider(value),
    onSuccess: () => {
      invalidate();
      setModalOpen(false);
      toast.success('Prestador cadastrado.');
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Falha ao cadastrar prestador')),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: ProviderFormValue }) =>
      adminApi.updateProvider(id, value),
    onSuccess: () => {
      invalidate();
      setModalOpen(false);
      setEditing(null);
      toast.success('Prestador atualizado.');
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Falha ao atualizar prestador')),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      adminApi.updateProvider(id, { active }),
    onSuccess: invalidate,
    onError: (err) => toast.error(apiErrorMessage(err, 'Falha ao atualizar prestador')),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prestadores de serviço"
        actions={
          <CustomButton onClick={() => { setEditing(null); setModalOpen(true); }}>
            <Plus className="size-4" /> Novo prestador
          </CustomButton>
        }
      />

      <div className="overflow-hidden rounded-xl border border-border bg-surface-raised">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Telefone</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Ativo</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  Carregando...
                </td>
              </tr>
            ) : (
              providers.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-foreground">{p.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.phone}</td>
                  <td className="px-4 py-3 text-muted-foreground">{TYPE_LABEL[p.type] ?? p.type}</td>
                  <td className="px-4 py-3">
                    <Toggle
                      checked={p.active}
                      onChange={(v) => toggleActiveMutation.mutate({ id: p.id, active: v })}
                      aria-label={`Ativar/desativar ${p.name}`}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="text-xs font-medium text-accent-ink hover:underline"
                      onClick={() => { setEditing(p); setModalOpen(true); }}
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ProviderFormModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        onSubmit={(value) =>
          editing ? updateMutation.mutate({ id: editing.id, value }) : createMutation.mutate(value)
        }
        initialValue={editing ?? undefined}
      />
    </div>
  );
}
```

(Conferir a assinatura real de `PageHeader` — se não aceitar `actions`, usar o padrão já existente em `coordinators/index.tsx` ou `properties/index.tsx` para o botão "novo".)

- [ ] **Step 6: Verificar**

Run: `cd apps/web && bunx tsc --noEmit && bun run lint`
Expected: PASS. Depois `bun run dev` e abrir `/providers` no navegador — confirmar visualmente tabela + modal + toggle funcionando (não há como automatizar o roteamento file-based sem subir o dev server).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/routes/_dashboard/providers apps/web/src/components/provider-form-modal.tsx apps/web/src/__tests__/provider-form-modal.test.tsx
git commit -m "feat(web): add /providers CRUD page"
```

---

### Task 13: Estender a seção "Chamados & Reclamações" com manutenção + galeria de fotos

**Files:**
- Modify: `apps/web/src/components/complaints-section.tsx`
- Modify: `apps/web/src/__tests__/complaints-section.test.tsx`
- Modify: `apps/web/src/routes/_dashboard/tenants/$tenantId.tsx`

**Interfaces:**
- Consumes: `fetchTenantMaintenanceRequests` (Task 11), `adminApi.updateMaintenanceStatus`.
- Produces: `ComplaintsSection` passa a aceitar `maintenanceRequests` além de `complaints`, renderizando os dois tipos numa lista única ordenada por `createdAt` — sem quebrar as chamadas existentes (rename de props exige atualizar o único consumidor, `$tenantId.tsx`).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar em `apps/web/src/__tests__/complaints-section.test.tsx`:

```typescript
import type { MaintenanceRequest } from '@kit-manager/types';

function makeMaintenanceRequest(overrides: Partial<MaintenanceRequest> = {}): MaintenanceRequest {
  return {
    id: 'maintenance-1',
    ownerId: 'owner-1',
    tenantId: 'tenant-1',
    propertyId: 'property-1',
    type: 'hidraulica',
    responsibility: 'owner',
    severity: 'media',
    summary: 'Vazamento sob a pia',
    status: 'open',
    mediaUrls: ['https://signed.example/photo.jpg'],
    createdAt: '2026-07-29T01:00:00Z',
    updatedAt: '2026-07-29T01:00:00Z',
    ...overrides,
  };
}

describe('ComplaintsSection — manutenção', () => {
  test('renderiza chamados de manutenção junto com reclamações', () => {
    render(
      <ComplaintsSection
        complaints={[makeComplaint()]}
        maintenanceRequests={[makeMaintenanceRequest()]}
        isLoading={false}
        isAdvancing={false}
        onAdvanceStatus={vi.fn()}
        onAdvanceMaintenanceStatus={vi.fn()}
      />,
    );
    expect(screen.getByText('Vazamento sob a pia')).toBeInTheDocument();
  });

  test('exibe a galeria de fotos do chamado de manutenção', () => {
    render(
      <ComplaintsSection
        complaints={[]}
        maintenanceRequests={[makeMaintenanceRequest()]}
        isLoading={false}
        isAdvancing={false}
        onAdvanceStatus={vi.fn()}
        onAdvanceMaintenanceStatus={vi.fn()}
      />,
    );
    expect(screen.getByAltText(/foto do chamado/i)).toHaveAttribute('src', 'https://signed.example/photo.jpg');
  });

  test('avança status de manutenção chama onAdvanceMaintenanceStatus com in_progress', () => {
    const onAdvanceMaintenanceStatus = vi.fn();
    render(
      <ComplaintsSection
        complaints={[]}
        maintenanceRequests={[makeMaintenanceRequest({ status: 'acknowledged' })]}
        isLoading={false}
        isAdvancing={false}
        onAdvanceStatus={vi.fn()}
        onAdvanceMaintenanceStatus={onAdvanceMaintenanceStatus}
      />,
    );
    fireEvent.click(screen.getByText(/marcar como em andamento/i));
    expect(onAdvanceMaintenanceStatus).toHaveBeenCalledWith('maintenance-1', 'in_progress');
  });
});
```

Ajustar as chamadas dos testes já existentes no arquivo (os 4 testes de `ComplaintsSection` originais) para passar `maintenanceRequests={[]}` e `onAdvanceMaintenanceStatus={vi.fn()}` — props novas obrigatórias.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd apps/web && bunx vitest run src/__tests__/complaints-section.test.tsx`
Expected: FAIL — props não existem.

- [ ] **Step 3: Implementar**

Reescrever `apps/web/src/components/complaints-section.tsx`:

```tsx
import type { Complaint, ComplaintStatus, MaintenanceRequest, MaintenanceStatus } from '@kit-manager/types';
import type { ComponentProps } from 'react';
import { twMerge } from 'tailwind-merge';
import { Pill } from '@/components/ui/pill';

const COMPLAINT_STATUS_TONE: Record<ComplaintStatus, 'warn' | 'accent' | 'ok'> = {
  open: 'warn',
  acknowledged: 'accent',
  resolved: 'ok',
};
const COMPLAINT_STATUS_LABEL: Record<ComplaintStatus, string> = {
  open: 'Aberta',
  acknowledged: 'Reconhecida',
  resolved: 'Resolvida',
};
const COMPLAINT_NEXT_STATUS: Record<ComplaintStatus, ComplaintStatus | null> = {
  open: 'acknowledged',
  acknowledged: 'resolved',
  resolved: null,
};

const MAINTENANCE_STATUS_TONE: Record<MaintenanceStatus, 'warn' | 'accent' | 'ok'> = {
  open: 'warn',
  acknowledged: 'accent',
  in_progress: 'accent',
  resolved: 'ok',
};
const MAINTENANCE_STATUS_LABEL: Record<MaintenanceStatus, string> = {
  open: 'Aberto',
  acknowledged: 'Reconhecido',
  in_progress: 'Em andamento',
  resolved: 'Resolvido',
};
const MAINTENANCE_NEXT_STATUS: Record<MaintenanceStatus, MaintenanceStatus | null> = {
  open: 'acknowledged',
  acknowledged: 'in_progress',
  in_progress: 'resolved',
  resolved: null,
};

const MAINTENANCE_TYPE_LABEL: Record<string, string> = {
  eletrica: 'Elétrica',
  hidraulica: 'Hidráulica',
  civil: 'Civil',
  limpeza_conservacao: 'Limpeza/Conservação',
};

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

type UnifiedItem =
  | { kind: 'complaint'; createdAt: string; data: Complaint }
  | { kind: 'maintenance'; createdAt: string; data: MaintenanceRequest };

interface ComplaintsSectionProps extends Omit<ComponentProps<'div'>, 'children'> {
  complaints: Complaint[];
  maintenanceRequests: MaintenanceRequest[];
  isLoading: boolean;
  isAdvancing: boolean;
  onAdvanceStatus: (id: string, status: ComplaintStatus) => void;
  onAdvanceMaintenanceStatus: (id: string, status: MaintenanceStatus) => void;
}

export function ComplaintsSection({
  complaints,
  maintenanceRequests,
  isLoading,
  isAdvancing,
  onAdvanceStatus,
  onAdvanceMaintenanceStatus,
  className,
  ...props
}: ComplaintsSectionProps) {
  if (!isLoading && complaints.length === 0 && maintenanceRequests.length === 0) return null;

  const items: UnifiedItem[] = [
    ...complaints.map((c): UnifiedItem => ({ kind: 'complaint', createdAt: c.createdAt, data: c })),
    ...maintenanceRequests.map((m): UnifiedItem => ({ kind: 'maintenance', createdAt: m.createdAt, data: m })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div
      data-slot="complaints-section"
      data-state={isLoading ? 'loading' : 'ready'}
      className={twMerge('rounded-xl border border-border bg-surface-raised p-5', className)}
      {...props}
    >
      <h2 className="mb-4 text-sm font-medium text-foreground">Chamados & Reclamações</h2>
      {isLoading ? (
        <div className="space-y-2">
          <div className="h-14 animate-pulse rounded-lg bg-muted" />
          <div className="h-14 animate-pulse rounded-lg bg-muted" />
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) =>
            item.kind === 'complaint' ? (
              <ComplaintRow key={item.data.id} complaint={item.data} isAdvancing={isAdvancing} onAdvanceStatus={onAdvanceStatus} />
            ) : (
              <MaintenanceRow
                key={item.data.id}
                request={item.data}
                isAdvancing={isAdvancing}
                onAdvanceStatus={onAdvanceMaintenanceStatus}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function ComplaintRow({
  complaint,
  isAdvancing,
  onAdvanceStatus,
}: {
  complaint: Complaint;
  isAdvancing: boolean;
  onAdvanceStatus: (id: string, status: ComplaintStatus) => void;
}) {
  const next = COMPLAINT_NEXT_STATUS[complaint.status];
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground">{complaint.summary}</p>
        <Pill tone={COMPLAINT_STATUS_TONE[complaint.status]} dot>
          {COMPLAINT_STATUS_LABEL[complaint.status]}
        </Pill>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{complaint.content}</p>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{dateFmt.format(new Date(complaint.createdAt))}</span>
        {next && (
          <button
            type="button"
            onClick={() => onAdvanceStatus(complaint.id, next)}
            disabled={isAdvancing}
            className="text-xs font-medium text-accent-ink hover:underline disabled:opacity-50"
          >
            Marcar como {COMPLAINT_STATUS_LABEL[next].toLowerCase()}
          </button>
        )}
      </div>
    </div>
  );
}

function MaintenanceRow({
  request,
  isAdvancing,
  onAdvanceStatus,
}: {
  request: MaintenanceRequest;
  isAdvancing: boolean;
  onAdvanceStatus: (id: string, status: MaintenanceStatus) => void;
}) {
  const next = MAINTENANCE_NEXT_STATUS[request.status];
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground">{request.summary}</p>
        <Pill tone={MAINTENANCE_STATUS_TONE[request.status]} dot>
          {MAINTENANCE_STATUS_LABEL[request.status]}
        </Pill>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {MAINTENANCE_TYPE_LABEL[request.type] ?? request.type} · severidade {request.severity} · responsabilidade{' '}
        {request.responsibility}
      </p>
      {request.mediaUrls.length > 0 && (
        <div className="mt-2 flex gap-2">
          {request.mediaUrls.map((url) => (
            <a key={url} href={url} target="_blank" rel="noreferrer">
              <img src={url} alt="Foto do chamado" className="size-16 rounded-md object-cover" />
            </a>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{dateFmt.format(new Date(request.createdAt))}</span>
        {next && (
          <button
            type="button"
            onClick={() => onAdvanceStatus(request.id, next)}
            disabled={isAdvancing}
            className="text-xs font-medium text-accent-ink hover:underline disabled:opacity-50"
          >
            Marcar como {MAINTENANCE_STATUS_LABEL[next].toLowerCase()}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd apps/web && bunx vitest run src/__tests__/complaints-section.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire em `$tenantId.tsx`**

Adicionar o import de `fetchTenantMaintenanceRequests` e `MaintenanceStatus`, o `useQuery` de manutenção e a mutation, seguindo exatamente o padrão já usado para `complaints` no mesmo arquivo (linhas 64-75 vistas durante o brainstorm):

```typescript
const { data: maintenanceRequests = [], isLoading: maintenanceLoading } = useQuery({
  queryKey: ['tenant-maintenance', tenantId],
  queryFn: () => fetchTenantMaintenanceRequests(tenantId),
  enabled: !!data,
});

const advanceMaintenanceStatus = useMutation({
  mutationFn: ({ id, status }: { id: string; status: MaintenanceStatus }) =>
    adminApi.updateMaintenanceStatus(id, status),
  onSuccess: () => {
    void qc.invalidateQueries({ queryKey: ['tenant-maintenance', tenantId] });
  },
});
```

E atualizar a chamada de `<ComplaintsSection ... />` para incluir:

```tsx
<ComplaintsSection
  complaints={complaints}
  maintenanceRequests={maintenanceRequests}
  isLoading={complaintsLoading || maintenanceLoading}
  isAdvancing={advanceComplaintStatus.isPending || advanceMaintenanceStatus.isPending}
  onAdvanceStatus={(id, status) => advanceComplaintStatus.mutate({ id, status })}
  onAdvanceMaintenanceStatus={(id, status) => advanceMaintenanceStatus.mutate({ id, status })}
/>
```

- [ ] **Step 6: Verificar**

Run: `cd apps/web && bunx tsc --noEmit && bun run lint && bunx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/complaints-section.tsx apps/web/src/__tests__/complaints-section.test.tsx apps/web/src/routes/_dashboard/tenants/\$tenantId.tsx
git commit -m "feat(web): show maintenance requests with photo gallery in tenant detail"
```

---

### Task 14: Verificação final da slice + atualizar tracking

**Files:**
- Modify: `PRD-FASE2.md`

- [ ] **Step 1: Rodar a suíte completa**

Run:
```bash
cd apps/bot && bun run check
cd ../web && bunx tsc --noEmit && bun run lint && bunx vitest run
```
Expected: 100% verde nos dois apps.

- [ ] **Step 2: Smoke test manual mínimo**

Subir o bot local (`docker compose up -d --build bot`) e o painel (`cd apps/web && bun run dev`); confirmar visualmente: `/providers` lista/cria/edita/ativa-desativa; detalhe do tenant mostra chamados de manutenção com foto (se houver dado de teste) e permite avançar status.

- [ ] **Step 3: Marcar os checkboxes de Build/Simplify/Review pendentes no `PRD-FASE2.md`**

Marcar `[x]` nos itens de Build da T3 (linhas 179-186 na versão atual do arquivo) com uma linha de resumo por bullet, no mesmo padrão de T1/T2 (mencionar decisões tomadas nesta sessão: bucket `leads` reusado, precedência mídia+texto, responsabilidade decidida pelo agente).

- [ ] **Step 4: Commit final da etapa de Build**

```bash
git add PRD-FASE2.md
git commit -m "docs: mark T3 build tasks done in PRD-FASE2.md tracking"
```

---

## Depois do Build

Seguir o pipeline do PRD-FASE2.md: **5. Simplify** (`agent-skills:code-simplification`) → **6. Review** (`agent-skills:code-review-and-quality` local → `gh pr create` → CodeRabbit no PR → loop até limpo) → merge do Fred. `docs/lei-inquilinato-resumo.md` precisa de revisão explícita do Fred (conteúdo jurídico) antes do merge — não é um achado de review técnico, é aprovação de conteúdo.
