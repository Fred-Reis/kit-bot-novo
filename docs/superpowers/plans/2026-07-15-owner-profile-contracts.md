# Perfil do proprietário para contratos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar CPF, CNPJ (opcional) e endereço ao `Owner`, editáveis em Config > Workspace, e usá-los para resolver `{{cpf_locador}}`, `{{cnpj_locador}}`, `{{endereco_locador}}` na geração automática de variáveis de contrato.

**Architecture:** Três campos nullable novos no `Owner` (Prisma). Lógica pura de resolução de variáveis (`buildLeadAutoMap`) extraída de `admin.ts` pra `src/services/contract-variables.ts`, testável isoladamente. Novo endpoint `PATCH /admin/workspace/profile` segue o padrão exato de `PATCH /admin/workspace/notifications` (mesmo arquivo, mesmo estilo de validação por regex, `prisma.owner.findFirst()` single-tenant). No web, `WorkspaceSection` (hoje placeholder hardcoded) vira form real seguindo o padrão de `NotificationContactCard`.

**Tech Stack:** Bun, TypeScript, Fastify, Prisma, PostgreSQL (Supabase), `bun:test` (bot); Vite, React 19, TanStack Query, vitest (web).

## Global Constraints

- Bun apenas — sem npm/yarn.
- Nome do locador reusa `Owner.name` existente — não criar campo `ownerName` separado.
- Endereço é campo de texto único (`address: String?`) — não estruturado.
- Validação de CPF/CNPJ é só de formato (contagem de dígitos), sem dígito verificador — consistente com `E164_RE`/`EMAIL_RE` já usados em `/admin/workspace/notifications`.
- CNPJ é opcional; CPF e endereço também são nullable no schema (Owner rows existentes não têm esses dados).
- Sem `export default` em componentes React; sem cores hardcoded; sem barrel files.
- Migrations do bot seguem convenção `YYYYMMDDHHMMSS_owner_<descrição>` quando alteram `Owner`.

Spec completa: `docs/superpowers/specs/2026-07-15-owner-profile-contracts-design.md`

---

### Task 1: Schema — campos de perfil no `Owner`

**Files:**
- Modify: `apps/bot/prisma/schema.prisma:9-31` (model `Owner`)
- Create: migration gerada por `prisma migrate dev` (nome `owner_profile_fields`)

**Interfaces:**
- Produces: `Owner.cpf: string | null`, `Owner.cnpj: string | null`, `Owner.address: string | null` — consumidos pelas Tasks 2, 5, 6.

- [ ] **Step 1: Editar o model `Owner`**

Em `apps/bot/prisma/schema.prisma`, dentro do model `Owner` (logo após `botEnabled`):

```prisma
model Owner {
  id                String             @id @default(uuid())
  name              String
  phone             String             @unique
  email             String?            @unique
  notificationPhone String?
  notificationEmail String?
  botEnabled        Boolean            @default(true)
  cpf               String?
  cnpj              String?
  address           String?
  properties        Property[]
  tenants           Tenant[]
  leads             Lead[]
  payments          Payment[]
  contracts         Contract[]
  ruleSets          RuleSet[]
  contractTemplates ContractTemplate[]
  propertyMedias    PropertyMedia[]
  leadDocuments     LeadDocument[]
  leadResidents     LeadResident[]
  activityLogs      ActivityLog[]
  conversations     Conversation[]
  events            Event[]
  createdAt         DateTime           @default(now())
}
```

- [ ] **Step 2: Gerar e aplicar a migration**

Rodar de dentro de `apps/bot`:

```bash
bunx prisma migrate dev --name owner_profile_fields
```

Expected: cria `apps/bot/prisma/migrations/<timestamp>_owner_profile_fields/migration.sql` com três `ALTER TABLE "Owner" ADD COLUMN` (cpf, cnpj, address, todos `TEXT` nullable), aplica no banco de dev, regenera o Prisma Client. Comando termina sem erro.

- [ ] **Step 3: Verificar**

```bash
bunx prisma studio
```
(ou `psql`/Supabase dashboard) — confirmar que a tabela `Owner` tem as três colunas novas, todas nullable, sem valor default.

- [ ] **Step 4: Commit**

```bash
git add apps/bot/prisma/schema.prisma apps/bot/prisma/migrations
git commit -m "feat(bot): add cpf, cnpj, address fields to Owner"
```

---

### Task 2: Shared type — `Owner` em `packages/types`

**Files:**
- Modify: `packages/types/src/property.ts:52-60`

**Interfaces:**
- Consumes: nenhum (type puro)
- Produces: `Owner` type com `cpf`, `cnpj`, `address`, `botEnabled` — consumido pelo web em `apps/web/src/lib/queries.ts` (Task 7) e por qualquer import futuro do tipo compartilhado.

- [ ] **Step 1: Atualizar a interface**

Em `packages/types/src/property.ts`, substituir:

```ts
export interface Owner {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  notificationPhone: string | null;
  notificationEmail: string | null;
  createdAt: string;
}
```

por:

```ts
export interface Owner {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  notificationPhone: string | null;
  notificationEmail: string | null;
  botEnabled: boolean;
  cpf: string | null;
  cnpj: string | null;
  address: string | null;
  createdAt: string;
}
```

- [ ] **Step 2: Typecheck do package**

```bash
cd packages/types && bunx tsc --noEmit
```
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/property.ts
git commit -m "feat(types): add botEnabled, cpf, cnpj, address to Owner type"
```

---

### Task 3: Validadores de formato de CPF/CNPJ

**Files:**
- Modify: `apps/bot/src/services/cpf.ts`
- Test: `apps/bot/src/__tests__/cpf.test.ts`

**Interfaces:**
- Produces: `isValidCpfFormat(raw: string): boolean`, `isValidCnpjFormat(raw: string): boolean` — consumidos pela Task 6 (`PATCH /admin/workspace/profile`).

- [ ] **Step 1: Escrever os testes que falham**

Primeiro, editar a linha de import já existente no topo de `apps/bot/src/__tests__/cpf.test.ts` — trocar:

```ts
import { extractCpfFromDocs } from '@/services/cpf';
```

por:

```ts
import { extractCpfFromDocs, isValidCnpjFormat, isValidCpfFormat } from '@/services/cpf';
```

Depois, adicionar ao final do arquivo (mesmo arquivo, mesmo padrão `describe`/`test` já usado, sem nova linha de `import`):

```ts
describe('isValidCpfFormat', () => {
  test('accepts 11 unformatted digits', () => {
    expect(isValidCpfFormat('12345678909')).toBe(true);
  });

  test('accepts formatted CPF', () => {
    expect(isValidCpfFormat('123.456.789-09')).toBe(true);
  });

  test('rejects fewer than 11 digits', () => {
    expect(isValidCpfFormat('1234567890')).toBe(false);
  });

  test('rejects more than 11 digits', () => {
    expect(isValidCpfFormat('123456789099')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(isValidCpfFormat('')).toBe(false);
  });
});

describe('isValidCnpjFormat', () => {
  test('accepts 14 unformatted digits', () => {
    expect(isValidCnpjFormat('12345678000199')).toBe(true);
  });

  test('accepts formatted CNPJ', () => {
    expect(isValidCnpjFormat('12.345.678/0001-99')).toBe(true);
  });

  test('rejects fewer than 14 digits', () => {
    expect(isValidCnpjFormat('1234567800019')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(isValidCnpjFormat('')).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd apps/bot && bun test src/__tests__/cpf.test.ts
```
Expected: FAIL — `isValidCnpjFormat`/`isValidCpfFormat` não exportados de `@/services/cpf`.

- [ ] **Step 3: Implementar**

Adicionar em `apps/bot/src/services/cpf.ts` (junto às outras funções exportadas, ex.: após `maskCpf`):

```ts
export function isValidCpfFormat(raw: string): boolean {
  return raw.replace(/\D/g, '').length === 11;
}

export function isValidCnpjFormat(raw: string): boolean {
  return raw.replace(/\D/g, '').length === 14;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
cd apps/bot && bun test src/__tests__/cpf.test.ts
```
Expected: todos os testes PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/services/cpf.ts apps/bot/src/__tests__/cpf.test.ts
git commit -m "feat(bot): add CPF/CNPJ format validators"
```

---

### Task 4: Extrair `buildLeadAutoMap` para `services/contract-variables.ts`

Refatoração pura — nenhuma mudança de comportamento. Necessária porque `admin.ts` importa `@supabase/supabase-js` e cria um client no top-level (`admin.ts:18`), o que exige env vars do Supabase carregadas pra sequer importar o arquivo em teste. Extrair a lógica pura pra um arquivo sem esse efeito colateral permite testar `buildLeadAutoMap` isoladamente.

**Files:**
- Create: `apps/bot/src/services/contract-variables.ts`
- Modify: `apps/bot/src/routes/admin.ts:20-99` (remove definições, adiciona import)
- Test: `apps/bot/src/__tests__/contract-variables.test.ts`

**Interfaces:**
- Consumes: nada externo (função pura)
- Produces: `buildLeadAutoMap(lead, property, paymentDayOfMonth, cpf, rg?): Record<string, string>`, `uniquePlaceholders(text: string): string[]` e `formatDatePtBR(d: Date): string`, exportados de `@/services/contract-variables` — consumidos por `admin.ts` (`buildLeadAutoMap`/`uniquePlaceholders` nas linhas 439, 440, 508, 511; `formatDatePtBR` isoladamente na linha 718, no endpoint de finalização de contrato) e pela Task 5.

**Nota:** `formatDatePtBR` é usado em `admin.ts:718` (endpoint de assinatura/finalização de contrato), fora do bloco de `buildLeadAutoMap` — por isso precisa ser exportado do novo serviço e importado em `admin.ts`, não só usado internamente.

- [ ] **Step 1: Escrever o teste de caracterização (comportamento atual)**

Criar `apps/bot/src/__tests__/contract-variables.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { buildLeadAutoMap, uniquePlaceholders } from '@/services/contract-variables';

const baseProperty = {
  externalId: 'KIT-01',
  name: 'Kit Centro',
  address: 'Rua A, 100',
  complement: 'Apto 2',
  neighborhood: 'Centro',
  rent: 1500,
  deposit: 1500,
  contractMonths: 12,
  owner: { name: 'Maria Proprietária' },
};

const baseLead = { name: 'João Locatário', phone: '5511999990000@s.whatsapp.net' };

describe('uniquePlaceholders', () => {
  test('extracts unique {{var}} tokens, ignoring duplicates', () => {
    expect(uniquePlaceholders('{{nome_locador}} e {{nome_locador}} - {{cpf_locador}}')).toEqual([
      '{{nome_locador}}',
      '{{cpf_locador}}',
    ]);
  });

  test('returns empty array when no placeholders', () => {
    expect(uniquePlaceholders('sem variáveis aqui')).toEqual([]);
  });
});

describe('buildLeadAutoMap', () => {
  test('maps locatário fields from lead', () => {
    const map = buildLeadAutoMap(baseLead, baseProperty, 10, '123.456.789-09', '12.345.678-9');
    expect(map.nome_locatario).toBe('João Locatário');
    expect(map.cpf_locatario).toBe('123.456.789-09');
    expect(map.rg_locatario).toBe('12.345.678-9');
    expect(map.telefone_locatario).toBe('5511999990000');
  });

  test('maps locador name from property.owner', () => {
    const map = buildLeadAutoMap(baseLead, baseProperty, 10, null);
    expect(map.locador).toBe('Maria Proprietária');
    expect(map.nome_locador).toBe('Maria Proprietária');
  });

  test('maps imóvel, valores e prazo', () => {
    const map = buildLeadAutoMap(baseLead, baseProperty, 15, null);
    expect(map.unidade).toBe('KIT-01');
    expect(map.endereco).toBe('Rua A, 100, Apto 2');
    expect(map.bairro).toBe('Centro');
    expect(map.aluguel).toBe('R$ 1.500,00');
    expect(map.prazo_meses).toBe('12');
    expect(map.vencimento).toBe('15');
  });

  test('omits cpf_locatario/rg_locatario when null', () => {
    const map = buildLeadAutoMap(baseLead, baseProperty, 10, null);
    expect('cpf_locatario' in map).toBe(false);
    expect('rg_locatario' in map).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd apps/bot && bun test src/__tests__/contract-variables.test.ts
```
Expected: FAIL — módulo `@/services/contract-variables` não existe.

- [ ] **Step 3: Criar o serviço movendo o código de `admin.ts`**

Criar `apps/bot/src/services/contract-variables.ts`:

```ts
const TEMPLATE_VAR_RE = /\{\{([^}]+)\}\}/g;

export const formatDatePtBR = (d: Date): string =>
  d.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

export function uniquePlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(TEMPLATE_VAR_RE)].map((m) => m[0]))];
}

export function buildLeadAutoMap(
  lead: { name: string | null; phone: string },
  property: {
    externalId: string;
    name: string;
    address: string;
    complement: string | null;
    neighborhood: string;
    rent: unknown;
    deposit: unknown;
    contractMonths: number | null;
    owner?: { name: string } | null;
  },
  paymentDayOfMonth: number,
  cpf: string | null,
  rg: string | null = null,
): Record<string, string> {
  const fmt = (n: unknown) =>
    Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const today = new Date();
  const months = property.contractMonths ?? 12;
  const endDate = new Date(today.getFullYear(), today.getMonth() + months, today.getDate());
  const fullAddress = [property.address, property.complement].filter(Boolean).join(', ');
  const ownerName = property.owner?.name ?? '';
  const rentFmt = fmt(property.rent);
  const depositFmt = fmt(property.deposit);

  return {
    // locatário
    locatario: lead.name ?? lead.phone,
    nome_locatario: lead.name ?? lead.phone,
    ...(cpf !== null ? { cpf_locatario: cpf } : {}),
    ...(rg !== null ? { rg_locatario: rg } : {}),
    telefone_locatario: lead.phone.replace(/@[^@]+$/, ''),
    // locador
    locador: ownerName,
    nome_locador: ownerName,
    // imóvel
    unidade: property.externalId,
    id_imovel: property.externalId,
    imovel: property.name,
    nome_imovel: property.name,
    endereco: fullAddress,
    endereco_imovel: fullAddress,
    complemento_imovel: property.complement ?? '',
    bairro: property.neighborhood,
    bairro_imovel: property.neighborhood,
    // valores
    aluguel: rentFmt,
    valor_aluguel: rentFmt,
    deposito: depositFmt,
    caucao: depositFmt,
    valor_caucao: depositFmt,
    // prazo e datas
    prazo_meses: String(months),
    prazo: String(months),
    data_hoje: formatDatePtBR(today),
    data_inicio: formatDatePtBR(today),
    data_termino: formatDatePtBR(endDate),
    data_assinatura: 'A ser preenchida na assinatura',
    vencimento: String(paymentDayOfMonth),
    dia_vencimento: String(paymentDayOfMonth),
  };
}
```

Em `apps/bot/src/routes/admin.ts`:
- Remover as definições de `TEMPLATE_VAR_RE`, `formatDatePtBR`, `uniquePlaceholders` e `buildLeadAutoMap` (linhas 20-21, 22-28, 30-32, 36-99).
- Adicionar import no topo (junto aos outros imports de `@/services/...`). **Importante:** `formatDatePtBR` também é usado isoladamente em `admin.ts:718` (fora do bloco removido, no endpoint de finalização/assinatura de contrato), então precisa entrar nesse import mesmo não sendo chamado diretamente perto de `buildLeadAutoMap`:

```ts
import { buildLeadAutoMap, formatDatePtBR, uniquePlaceholders } from '@/services/contract-variables';
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
cd apps/bot && bun test src/__tests__/contract-variables.test.ts
```
Expected: todos os testes PASS.

- [ ] **Step 5: Confirmar que `admin.ts` ainda compila e os outros testes não quebraram**

```bash
cd apps/bot && bunx tsc --noEmit && bun test src/__tests__
```
Expected: typecheck sem erros; suíte roda com a mesma contagem de testes de antes + os novos (pré-existentes 2 fail/1 error, se houver, permanecem os mesmos — não piorar).

- [ ] **Step 6: Commit**

```bash
git add apps/bot/src/services/contract-variables.ts apps/bot/src/routes/admin.ts apps/bot/src/__tests__/contract-variables.test.ts
git commit -m "refactor(bot): extract buildLeadAutoMap into services/contract-variables"
```

---

### Task 5: Resolver `cpf_locador`, `cnpj_locador`, `endereco_locador`

**Files:**
- Modify: `apps/bot/src/services/contract-variables.ts`
- Test: `apps/bot/src/__tests__/contract-variables.test.ts`

**Interfaces:**
- Consumes: `buildLeadAutoMap` (Task 4)
- Produces: `buildLeadAutoMap`'s `property.owner` type ganha `cpf?`, `cnpj?`, `address?` opcionais; map retornado ganha `cpf_locador`, `cnpj_locador`, `endereco_locador` condicionais — consumidos pelos endpoints em `admin.ts` (sem mudança de código lá, já usam `include: { owner: true }`).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao `describe('buildLeadAutoMap', ...)` em `apps/bot/src/__tests__/contract-variables.test.ts`:

```ts
  test('maps cpf_locador, cnpj_locador, endereco_locador when present on owner', () => {
    const property = {
      ...baseProperty,
      owner: { name: 'Maria Proprietária', cpf: '111.222.333-44', cnpj: '12.345.678/0001-99', address: 'Av. B, 200' },
    };
    const map = buildLeadAutoMap(baseLead, property, 10, null);
    expect(map.cpf_locador).toBe('111.222.333-44');
    expect(map.cnpj_locador).toBe('12.345.678/0001-99');
    expect(map.endereco_locador).toBe('Av. B, 200');
  });

  test('omits cpf_locador, cnpj_locador, endereco_locador when absent on owner', () => {
    const map = buildLeadAutoMap(baseLead, baseProperty, 10, null);
    expect('cpf_locador' in map).toBe(false);
    expect('cnpj_locador' in map).toBe(false);
    expect('endereco_locador' in map).toBe(false);
  });
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd apps/bot && bun test src/__tests__/contract-variables.test.ts
```
Expected: FAIL — `map.cpf_locador` etc. são `undefined`.

- [ ] **Step 3: Implementar**

Em `apps/bot/src/services/contract-variables.ts`, atualizar o tipo do parâmetro `property.owner` e o corpo de `buildLeadAutoMap`:

```ts
export function buildLeadAutoMap(
  lead: { name: string | null; phone: string },
  property: {
    externalId: string;
    name: string;
    address: string;
    complement: string | null;
    neighborhood: string;
    rent: unknown;
    deposit: unknown;
    contractMonths: number | null;
    owner?: { name: string; cpf?: string | null; cnpj?: string | null; address?: string | null } | null;
  },
  paymentDayOfMonth: number,
  cpf: string | null,
  rg: string | null = null,
): Record<string, string> {
  const fmt = (n: unknown) =>
    Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const today = new Date();
  const months = property.contractMonths ?? 12;
  const endDate = new Date(today.getFullYear(), today.getMonth() + months, today.getDate());
  const fullAddress = [property.address, property.complement].filter(Boolean).join(', ');
  const ownerName = property.owner?.name ?? '';
  const rentFmt = fmt(property.rent);
  const depositFmt = fmt(property.deposit);

  return {
    // locatário
    locatario: lead.name ?? lead.phone,
    nome_locatario: lead.name ?? lead.phone,
    ...(cpf !== null ? { cpf_locatario: cpf } : {}),
    ...(rg !== null ? { rg_locatario: rg } : {}),
    telefone_locatario: lead.phone.replace(/@[^@]+$/, ''),
    // locador
    locador: ownerName,
    nome_locador: ownerName,
    ...(property.owner?.cpf ? { cpf_locador: property.owner.cpf } : {}),
    ...(property.owner?.cnpj ? { cnpj_locador: property.owner.cnpj } : {}),
    ...(property.owner?.address ? { endereco_locador: property.owner.address } : {}),
    // imóvel
    unidade: property.externalId,
    id_imovel: property.externalId,
    imovel: property.name,
    nome_imovel: property.name,
    endereco: fullAddress,
    endereco_imovel: fullAddress,
    complemento_imovel: property.complement ?? '',
    bairro: property.neighborhood,
    bairro_imovel: property.neighborhood,
    // valores
    aluguel: rentFmt,
    valor_aluguel: rentFmt,
    deposito: depositFmt,
    caucao: depositFmt,
    valor_caucao: depositFmt,
    // prazo e datas
    prazo_meses: String(months),
    prazo: String(months),
    data_hoje: formatDatePtBR(today),
    data_inicio: formatDatePtBR(today),
    data_termino: formatDatePtBR(endDate),
    data_assinatura: 'A ser preenchida na assinatura',
    vencimento: String(paymentDayOfMonth),
    dia_vencimento: String(paymentDayOfMonth),
  };
}
```

(`formatDatePtBR` continua igual, já existe no arquivo desde a Task 4.)

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
cd apps/bot && bun test src/__tests__/contract-variables.test.ts
```
Expected: todos os testes PASS.

- [ ] **Step 5: Typecheck geral do bot**

```bash
cd apps/bot && bunx tsc --noEmit
```
Expected: sem erros. `admin.ts` passa `property.owner` vindo de `prisma.property.findUnique({ include: { owner: true } })`, que já inclui `cpf`/`cnpj`/`address` (Task 1) — nenhuma mudança de código necessária nas chamadas existentes (linhas ~439, ~508 de `admin.ts`).

- [ ] **Step 6: Commit**

```bash
git add apps/bot/src/services/contract-variables.ts apps/bot/src/__tests__/contract-variables.test.ts
git commit -m "feat(bot): resolve cpf_locador, cnpj_locador, endereco_locador from Owner"
```

---

### Task 6: Endpoint `PATCH /admin/workspace/profile`

**Files:**
- Modify: `apps/bot/src/routes/admin.ts` (adicionar após o bloco `PATCH /admin/workspace/notifications`, atualmente linhas 171-213)

**Interfaces:**
- Consumes: `isValidCpfFormat`, `isValidCnpjFormat` de `@/services/cpf` (Task 3)
- Produces: rota `PATCH /admin/workspace/profile` — body `{ name?, cpf?, cnpj?, address? }`, resposta `{ name, cpf, cnpj, address }` — consumida pelo web na Task 7 (`updateOwnerProfile`).

- [ ] **Step 1: Adicionar o import dos validadores**

Em `apps/bot/src/routes/admin.ts`, no import já existente de `@/services/cpf` (linha 13), adicionar os dois nomes:

```ts
import { extractCpfFromDocs, extractRgFromDocs, isValidCnpjFormat, isValidCpfFormat } from '@/services/cpf';
```

- [ ] **Step 2: Implementar o endpoint**

Logo após o bloco `PATCH /admin/workspace/notifications` (após a linha `);` que fecha esse handler, atualmente linha 213):

```ts
  // ─── owner profile (contract auto-fill) ──────────────────────────────────
  fastify.patch<{
    Body: { name?: string; cpf?: string | null; cnpj?: string | null; address?: string | null };
  }>(
    '/admin/workspace/profile',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { name, cpf, cnpj, address } = request.body;

      if (name !== undefined && name.trim() === '') {
        return reply.status(400).send({ error: 'name must not be empty' });
      }
      if (cpf != null && cpf !== '' && !isValidCpfFormat(cpf)) {
        return reply.status(400).send({ error: 'cpf must have 11 digits' });
      }
      if (cnpj != null && cnpj !== '' && !isValidCnpjFormat(cnpj)) {
        return reply.status(400).send({ error: 'cnpj must have 14 digits' });
      }

      const owner = await prisma.owner.findFirst();
      if (!owner) return reply.status(404).send({ error: 'Owner not found' });

      const data: { name?: string; cpf?: string | null; cnpj?: string | null; address?: string | null } = {};
      if (name !== undefined) data.name = name.trim();
      if (cpf !== undefined) data.cpf = cpf || null;
      if (cnpj !== undefined) data.cnpj = cnpj || null;
      if (address !== undefined) data.address = address || null;

      await prisma.owner.update({ where: { id: owner.id }, data });
      return reply.send({
        name: data.name ?? owner.name,
        cpf: cpf !== undefined ? data.cpf : owner.cpf,
        cnpj: cnpj !== undefined ? data.cnpj : owner.cnpj,
        address: address !== undefined ? data.address : owner.address,
      });
    },
  );
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/bot && bunx tsc --noEmit
```
Expected: sem erros (requer que a Task 1 já tenha rodado `prisma migrate dev`, regenerando o Prisma Client com `cpf`/`cnpj`/`address` em `Owner`).

- [ ] **Step 4: Verificação manual (dev server)**

```bash
cd apps/bot && bun run dev
```
Com o painel web (Task 8) ainda não pronto, verificar via login no admin (obter token de sessão do Supabase Auth no browser, aba Network) ou adiar a verificação funcional completa para o fim da Task 8, que exerce esse endpoint via UI logada. Confirmar aqui apenas que o servidor sobe sem erro e a rota aparece nos logs de registro do Fastify (nenhuma exceção de inicialização).

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/routes/admin.ts
git commit -m "feat(bot): add PATCH /admin/workspace/profile endpoint"
```

---

### Task 7: Web — `queries.ts` e `api.ts`

**Files:**
- Modify: `apps/web/src/lib/queries.ts:445-459`
- Modify: `apps/web/src/lib/api.ts:149-151`

**Interfaces:**
- Consumes: endpoint `PATCH /admin/workspace/profile` (Task 6); colunas `Owner.name/cpf/cnpj/address` via Supabase (Task 1)
- Produces: `OwnerSettings` com `name`, `cpf`, `cnpj`, `address`; `adminApi.updateOwnerProfile(data)` — consumidos pela Task 8.

- [ ] **Step 1: Atualizar `OwnerSettings` e `fetchOwner`**

Em `apps/web/src/lib/queries.ts`, substituir:

```ts
export interface OwnerSettings {
  id: string;
  botEnabled: boolean;
  notificationPhone: string | null;
  notificationEmail: string | null;
}

export async function fetchOwner(): Promise<OwnerSettings> {
  const { data, error } = await supabase
    .from('Owner')
    .select('id, botEnabled, notificationPhone, notificationEmail')
    .single();
  if (error) throw error;
  return data as OwnerSettings;
}
```

por:

```ts
export interface OwnerSettings {
  id: string;
  name: string;
  botEnabled: boolean;
  notificationPhone: string | null;
  notificationEmail: string | null;
  cpf: string | null;
  cnpj: string | null;
  address: string | null;
}

export async function fetchOwner(): Promise<OwnerSettings> {
  const { data, error } = await supabase
    .from('Owner')
    .select('id, name, botEnabled, notificationPhone, notificationEmail, cpf, cnpj, address')
    .single();
  if (error) throw error;
  return data as OwnerSettings;
}
```

- [ ] **Step 2: Adicionar `updateOwnerProfile` em `api.ts`**

Em `apps/web/src/lib/api.ts`, logo após `updateNotificationSettings` (linha 151, antes do `};` que fecha `adminApi`):

```ts
  updateOwnerProfile: (data: { name?: string; cpf?: string | null; cnpj?: string | null; address?: string | null }) =>
    botApi.patch('/admin/workspace/profile', data),
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/web && bunx tsc --noEmit
```
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/queries.ts apps/web/src/lib/api.ts
git commit -m "feat(web): add owner profile fields to queries and api client"
```

---

### Task 8: Web — form real em `WorkspaceSection` + verificação end-to-end

**Files:**
- Modify: `apps/web/src/routes/_dashboard/config/index.tsx:72-83` (`WorkspaceSection`)

**Interfaces:**
- Consumes: `fetchOwner`, `OwnerSettings` (Task 7), `adminApi.updateOwnerProfile` (Task 7)

- [ ] **Step 1: Substituir `WorkspaceSection`**

Em `apps/web/src/routes/_dashboard/config/index.tsx`, substituir a função `WorkspaceSection` (linhas 72-83):

```tsx
function WorkspaceSection() {
  return (
    <SectionCard title="Workspace" subtitle="Informações da empresa.">
      <ReadOnlyField label="Nome da empresa" value="kit-manager" />
      <ReadOnlyField label="CNPJ" value="—" />
      <ReadOnlyField label="Domínio" value="—" />
      <ReadOnlyField label="Idioma padrão" value="pt-BR" />
      <ReadOnlyField label="Moeda" value="BRL" />
      <ReadOnlyField label="Fuso horário" value="America/Sao_Paulo" />
    </SectionCard>
  );
}
```

por:

```tsx
function WorkspaceSection() {
  const qc = useQueryClient();
  const { data: owner } = useQuery({ queryKey: ['owner'], queryFn: fetchOwner });
  const [name, setName] = useState('');
  const [cpf, setCpf] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (owner) {
      setName(owner.name ?? '');
      setCpf(owner.cpf ?? '');
      setCnpj(owner.cnpj ?? '');
      setAddress(owner.address ?? '');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner?.id]);

  async function handleSave() {
    setSaving(true);
    try {
      await adminApi.updateOwnerProfile({ name, cpf, cnpj, address });
      void qc.invalidateQueries({ queryKey: ['owner'] });
      toast.success('Perfil do proprietário salvo.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Erro ao salvar perfil do proprietário.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      title="Workspace"
      subtitle="Dados do locador usados no preenchimento automático de contratos."
    >
      <div className="space-y-3">
        <FormField label="Nome do locador" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="CPF" hint="Somente números ou com máscara.">
          <Input placeholder="000.000.000-00" value={cpf} onChange={(e) => setCpf(e.target.value)} />
        </FormField>
        <FormField label="Endereço">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
        </FormField>
        <FormField label="CNPJ (opcional)" hint="Preencher só se o locador for pessoa jurídica.">
          <Input placeholder="00.000.000/0000-00" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
        </FormField>
      </div>
      <div className="mt-4 flex justify-end">
        <CustomButton variant="primary" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar'}
        </CustomButton>
      </div>
    </SectionCard>
  );
}
```

`ReadOnlyField` fica sem uso nesse arquivo depois dessa troca — checar no Step 3 se ainda é usado em outra section (não é: só `WorkspaceSection` usava). Remover a função `ReadOnlyField` (linhas 54-61) junto.

- [ ] **Step 2: Typecheck**

```bash
cd apps/web && bunx tsc --noEmit
```
Expected: sem erros (confirma que remover `ReadOnlyField` não quebrou nenhum outro uso).

- [ ] **Step 3: Lint**

```bash
cd apps/web && bunx oxlint src/routes/_dashboard/config/index.tsx
```
Expected: sem erros novos.

- [ ] **Step 4: Verificação manual end-to-end (bot + web)**

Terminal 1:
```bash
cd apps/bot && bun run dev
```
Terminal 2:
```bash
cd apps/web && bun run dev
```
No browser: logar no admin, ir em Configurações > Workspace, preencher Nome/CPF/Endereço (deixar CNPJ vazio), clicar Salvar. Confirmar:
1. Toast de sucesso aparece.
2. Reload da página — valores persistem (confirma que `PATCH /admin/workspace/profile` gravou e `fetchOwner` está lendo certo).
3. Digitar CPF com menos de 11 dígitos e salvar — toast de erro aparece (confirma validação 400 do backend chegando via `apiErrorMessage`).
4. Ir em um lead com imóvel vinculado e abrir "Aprovar KYC" (ou consultar `GET /admin/leads/:id/contract-variables` direto) — confirmar que `{{cpf_locador}}` e `{{endereco_locador}}` não aparecem mais em `unresolved` se o template publicado usar esses placeholders; `{{cnpj_locador}}` continua em `unresolved` (CNPJ ficou vazio).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/_dashboard/config/index.tsx
git commit -m "feat(web): editable owner profile form in Config > Workspace"
```

---

## Pós-implementação

Atualizar `ROADMAP.md`: marcar como `[x]` o item "Perfil do proprietário para contratos" (linha ~364-365) e mover a entrada #1 de "Próximas prioridades" pra fora da lista, adicionando à tabela de PRs mergeados quando o PR for aberto/mergeado.
