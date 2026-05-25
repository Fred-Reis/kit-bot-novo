# Plan: Slice 5 — Contracts (PDF + resolução de variáveis)

> Spec: [specs/contracts.md](../specs/contracts.md)
> Ordem: schema → types → bot services → bot endpoints → web api → web UI → ROADMAP

---

## Dependências macro

```
T01 (pdfkit install)
  └─→ T04 (pdf.ts service)
        └─→ T08 (GET /pdf endpoint)

T02 (migration + prisma generate)
  └─→ T03 (types)
        └─→ T06 (POST /preview endpoint)
              └─→ T07 (POST /contracts update)
  └─→ T08 (GET /pdf endpoint)
  └─→ T09 (POST /leads/mark-signed)

T05 (notify.ts update)
  └─→ T09 (POST /leads/mark-signed)

T03 (types) + T06–T09 (endpoints)
  └─→ T10 (web api.ts)
        └─→ T11 (modal 2 steps)
        └─→ T12 ($contractId PDF button)
        └─→ T13 ($leadId mark-signed button)

T11 + T12 + T13
  └─→ T14 (ROADMAP)
```

---

## T01 — Instalar pdfkit

**Arquivos:** `apps/bot/package.json`, `bun.lockb`

```bash
cd apps/bot && bun add pdfkit && bun add -d @types/pdfkit
```

**Critério de pronto:**
- `pdfkit` aparece em `dependencies` de `apps/bot/package.json`
- `@types/pdfkit` em `devDependencies`
- `bunx tsc --noEmit` verde em `apps/bot`

---

## T02 — Migration: `Contract.pdfUrl` + `prisma generate`

**Arquivos:**
- `apps/bot/prisma/migrations/20260524000003_contracts_slice_add_pdf_url/migration.sql` (novo)
- `apps/bot/prisma/schema.prisma`

**Migration SQL:**
```sql
ALTER TABLE "Contract" ADD COLUMN "pdfUrl" TEXT;
```

**Schema Prisma** — adicionar campo em `Contract`:
```prisma
pdfUrl      String?
```
Posicionado após `status String @default("active")`.

Após editar o schema:
```bash
cd apps/bot && bunx prisma generate
```

**Critério de pronto:**
- Arquivo de migration criado com o SQL correto
- `schema.prisma` contém `pdfUrl String?` em `Contract`
- `bunx prisma generate` executa sem erro
- `bunx tsc --noEmit` verde em `apps/bot`

---

## T03 — Tipos: `Contract.pdfUrl` + `ContractPreview` + `ContractVariableSuggestion`

**Arquivo:** `packages/types/src/contract.ts`

Mudanças:
1. Adicionar `pdfUrl: string | null` em `Contract` (após `status`)
2. Adicionar interface `ContractPreview`:
```ts
export interface ContractPreview {
  resolved: Record<string, string>;
  unresolved: string[];
  suggestions: ContractVariableSuggestion[];
}
```
3. Adicionar interface `ContractVariableSuggestion`:
```ts
export interface ContractVariableSuggestion {
  field: string;
  label: string;
  value: string;
}
```

> `packages/types/src/index.ts` já exporta `* from './contract'` — sem mudança necessária.

**Critério de pronto:**
- `Contract.pdfUrl: string | null` presente no tipo
- `ContractPreview` e `ContractVariableSuggestion` exportados
- `bunx tsc --noEmit` verde em `apps/bot` e `apps/web`

---

## T04 — `apps/bot/src/services/pdf.ts` (novo serviço)

**Arquivo:** `apps/bot/src/services/pdf.ts` (criar)

Exporta:
```ts
export async function generateAndUploadPdf(
  contractId: string,
  body: string,
  code: string,
): Promise<string>
```

Internamente:
- `renderPdf(body, code): Promise<Buffer>` — pdfkit: título mono `CONTRATO — {code}`, corpo justify com `lineGap: 4`, fonte `Helvetica`, tamanho 10pt
- Upload para bucket `contracts`, path `{contractId}.pdf`, `upsert: true`
- Retorna `publicUrl` via `supabase.storage.from('contracts').getPublicUrl(path).data.publicUrl`
- Cria cliente Supabase localmente com `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (mesmo padrão de `storage.ts`)

**Pré-condição:** bucket `contracts` deve existir no Supabase (verificar antes de buildar — criar via dashboard se necessário, público ou com policy de service_role).

**Critério de pronto:**
- Arquivo criado e sem erros de tipo
- `bunx tsc --noEmit` verde em `apps/bot`

---

## T05 — `notify.ts`: atualizar payload de `contract_signed`

**Arquivo:** `apps/bot/src/services/notify.ts`

O tipo atual tem `contract_signed: { tenantName: string; contractCode: string }`, mas no `mark-signed` o ator é ainda um lead (sem código de contrato garantido).

Mudança:
```ts
// antes
contract_signed: { tenantName: string; contractCode: string };
// depois
contract_signed: { leadName: string };
```

Atualizar `buildMessage` para o novo payload:
```ts
case 'contract_signed':
  return `✅ Contrato assinado por ${args.payload.leadName}. Próximo passo: confirmar pagamento.`;
```

**Critério de pronto:**
- Tipo e mensagem atualizados
- `bunx tsc --noEmit` verde em `apps/bot`

---

## ✅ CHECKPOINT 1 — Base pronta

> T01–T05 concluídos. Schema migrado, tipos atualizados, pdfkit instalado, pdf.ts pronto, notify.ts atualizado.
> tsc verde em ambos apps. Prosseguir para endpoints.

---

## T06 — Bot: `POST /admin/contracts/preview` (novo endpoint)

**Arquivo:** `apps/bot/src/routes/admin.ts`

Registrar **antes** do endpoint `POST /admin/contracts` existente.

```
POST /admin/contracts/preview
Auth: JWT admin
Body: { templateId, tenantId, propertyId, startDate, endDate?, monthlyRent }
Response: ContractPreview
```

Lógica:
1. Buscar `template`, `tenant`, `property`, `owner` em paralelo (`Promise.all`)
2. Extrair variáveis do `template.body` com regex `/{{\s*([^}]+)\s*}}/g`
3. Normalizar chave: `normalizeVar(s)` → `s.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()`
4. Construir `autoMap: Record<string, string>` com os pares normalizados → valor (ver spec §5.2)
5. Para cada variável extraída: se `normalizeVar(varName)` está no `autoMap` → vai para `resolved`; caso contrário → vai para `unresolved`
6. Construir `suggestions` (lista fixa com valores do banco — ver spec §5.2)
7. Retornar `{ resolved, unresolved, suggestions }`

**Validação de entrada:**
- 404 se template, tenant ou property não encontrado
- 400 se `monthlyRent <= 0`

**Critério de pronto:**
- Endpoint registrado e tipado
- Variáveis conhecidas resolvidas corretamente
- Variável desconhecida retorna em `unresolved`
- `suggestions` preenchida com valores reais do banco
- `bunx tsc --noEmit` verde

---

## T07 — Bot: atualizar `POST /admin/contracts` (variables + log)

**Arquivo:** `apps/bot/src/routes/admin.ts`

Mudanças no handler existente:
1. Adicionar `variables?: Record<string, string>` ao tipo do `Body`
2. Após buscar `template`, substituir variáveis:
```ts
let renderedBody = template.body;
for (const [placeholder, value] of Object.entries(variables ?? {})) {
  renderedBody = renderedBody.replaceAll(placeholder, value);
}
```
3. Salvar `body: renderedBody` (em vez de `template.body`)
4. Após `prisma.contract.create`, emitir `logActivity(...)` com `action: 'contract_created'`, `subjectType: 'contract'` (fire-and-forget)

**Critério de pronto:**
- `variables` aceito no body sem quebrar requests sem `variables`
- Body persistido com placeholders substituídos
- Log `contract_created` emitido
- `bunx tsc --noEmit` verde

---

## T08 — Bot: `GET /admin/contracts/:id/pdf` (substituir stub 501)

**Arquivo:** `apps/bot/src/routes/admin.ts`

Substituir o handler stub pelo real:
```ts
const contract = await prisma.contract.findUnique({
  where: { id },
  select: { id: true, code: true, body: true, pdfUrl: true },
});
if (!contract) return reply.status(404).send({ error: 'Contract not found' });

if (contract.pdfUrl) return reply.send({ url: contract.pdfUrl });

const url = await generateAndUploadPdf(contract.id, contract.body, contract.code);
await prisma.contract.update({ where: { id }, data: { pdfUrl: url } });
return reply.send({ url });
```

Importar `generateAndUploadPdf` de `@/services/pdf`.

**Critério de pronto:**
- Stub 501 removido
- Handler real retorna `{ url: string }`
- Cache via `pdfUrl` funciona (segunda chamada não regenera)
- `bunx tsc --noEmit` verde

---

## T09 — Bot: `POST /admin/leads/:id/mark-signed` (novo endpoint)

**Arquivo:** `apps/bot/src/routes/admin.ts`

```
POST /admin/leads/:id/mark-signed
Auth: JWT admin
Response: { success: true, stage: 'contract_signed' }
```

Lógica:
1. Buscar lead — 404 se não encontrado
2. Checar `lead.stage === 'contract_pending'` — 409 se diferente
3. `prisma.lead.update({ stage: 'contract_signed' })`
4. `logActivity(...)` com `action: 'contract_signed'`, `subjectType: 'lead'` (fire-and-forget)
5. `notifyOwner(lead.ownerId, 'contract_signed', { leadName: lead.name ?? lead.phone })` (fire-and-forget)
6. Retornar `{ success: true, stage: 'contract_signed' }`

**Critério de pronto:**
- 409 se stage incorreto
- Stage atualizado para `contract_signed`
- Log e notif emitidos
- `bunx tsc --noEmit` verde

---

## ✅ CHECKPOINT 2 — Backend completo

> T01–T09 concluídos. Todos os endpoints funcionais.
> `bunx tsc --noEmit` verde em `apps/bot`. Prosseguir para web.

---

## T10 — Web: `lib/api.ts` — adicionar métodos

**Arquivo:** `apps/web/src/lib/api.ts`

Adicionar ao objeto `adminApi`:
```ts
previewContract: (data: {
  templateId: string;
  tenantId: string;
  propertyId: string;
  startDate: string;
  endDate?: string;
  monthlyRent: number;
}) => botApi.post<ContractPreview>('/admin/contracts/preview', data),

markContractSigned: (leadId: string) =>
  botApi.post(`/admin/leads/${leadId}/mark-signed`),

getContractPdf: (contractId: string) =>
  botApi.get<{ url: string }>(`/admin/contracts/${contractId}/pdf`),
```

Atualizar `createContract` — adicionar `variables: Record<string, string>` ao tipo do body.

Importar `ContractPreview` de `@kit-manager/types`.

**Critério de pronto:**
- 4 métodos adicionados/atualizados
- Tipos corretos
- `bunx tsc --noEmit` verde em `apps/web`

---

## T11 — Web: `NewContractModal` em dois steps

**Arquivo:** `apps/web/src/routes/_dashboard/contracts/index.tsx`

Adicionar state `step: 1 | 2` e `preview: ContractPreview | null`.

**Step 1** (sem mudança de layout):
- Botão "Próximo →" substituindo "Criar contrato"
- Ao clicar: `setLoading(true)` → `adminApi.previewContract(form)` → `setPreview(data)` → `setStep(2)`
- Loading state: botão mostra "Verificando…" e fica desabilitado

**Step 2** (novo layout — dentro do mesmo modal, sem scroll externo):
- Título: "Variáveis do contrato"
- Se `preview.unresolved.length === 0` e `preview.resolved` vazio: texto "Nenhuma variável encontrada." + botão "Criar contrato" habilitado
- Seção "Mapeadas automaticamente" (se `resolved` não vazio): lista read-only de `[placeholder] → valor` em muted
- Seção "Precisam de associação" (se `unresolved.length > 0`): para cada variável:
  - Label com nome do placeholder
  - `<select>` com as `suggestions` (label + valor) + opção "Preencher manualmente"
  - Se "Preencher manualmente" selecionado: `<input type="text">` aparece abaixo
  - Valor armazenado em `manualValues: Record<string, string>` (state local)
- Botão "← Voltar" (volta para step 1, mantém form)
- Botão "Criar contrato" — habilitado apenas quando todos os `unresolved` têm valor em `manualValues`
- Ao criar: monta `variables = { ...resolved, ...manualValues }` → `adminApi.createContract({ ...form, variables })`

**Critério de pronto:**
- Step 1 → Step 2 funciona via chamada ao preview
- Variáveis mapeadas aparecem como read-only
- Variáveis não mapeadas têm select + input manual
- "Criar contrato" desabilitado se ainda há `unresolved` sem valor
- Contrato criado com sucesso (toast + invalidate query)
- `bunx tsc --noEmit` verde

---

## T12 — Web: `$contractId.tsx` — botão "Baixar PDF" funcional

**Arquivo:** `apps/web/src/routes/_dashboard/contracts/$contractId.tsx`

Substituir `toast.info('Em breve')` no botão "Baixar PDF":
1. Adicionar state `downloading: boolean`
2. `handleDownload`: `setDownloading(true)` → `adminApi.getContractPdf(contractId)` → `window.open(data.url, '_blank')` → `setDownloading(false)`
3. Catch: `toast.error('Falha ao gerar PDF')`
4. Botão: `disabled={downloading}`, texto `downloading ? 'Gerando…' : 'Baixar PDF'`

**Critério de pronto:**
- Botão chama endpoint real
- Loading state visível
- URL abre em nova aba
- Erro tratado com toast
- `bunx tsc --noEmit` verde

---

## T13 — Web: `$leadId.tsx` — botão "Marcar contrato assinado"

**Arquivo:** `apps/web/src/routes/_dashboard/leads/$leadId.tsx`

Adicionar bloco de action para `stage === 'contract_pending'` (inserir após o bloco `residents_docs_complete`):

```tsx
{lead.stage === 'contract_pending' && (
  <div className="flex gap-2">
    <CustomButton
      variant="primary"
      disabled={markSigned.isPending}
      onClick={() => markSigned.mutate()}
    >
      <CheckCircle className="size-4" />
      {markSigned.isPending ? 'Salvando...' : 'Marcar contrato assinado'}
    </CustomButton>
  </div>
)}
```

`markSigned` mutation:
- `mutationFn`: `() => adminApi.markContractSigned(leadId)`
- `onSuccess`: `qc.invalidateQueries({ queryKey: ['lead', leadId] })` + `toast.success('Contrato marcado como assinado')`
- `onError`: `toast.error('Falha ao marcar contrato')`

Importar `adminApi` (já importado) e adicionar a mutation junto com as existentes.

**Critério de pronto:**
- Botão aparece somente em `stage === 'contract_pending'`
- Mutation funciona, lead atualizado na UI
- `bunx tsc --noEmit` verde

---

## ✅ CHECKPOINT 3 — Web completo

> T10–T13 concluídos. UI funcional ponta-a-ponta.
> `bunx tsc --noEmit` verde em `apps/web`. Prosseguir para ROADMAP.

---

## T14 — Atualizar ROADMAP

**Arquivo:** `ROADMAP.md`

Marcar todos os itens da Slice 5 como `[x]`.

**Critério de pronto:**
- Todos os `[ ]` da Slice 5 viram `[x]`
- Tracking macro atualizado: `F1 — Vertical slices | 5/9`

---

## Ordem de execução

```
T01 → T02 → T03 → T04 → T05
                         ↓
                   T06 → T07
                   T08
                   T09
                         ↓
                   T10 → T11
                         T12
                         T13
                              ↓
                         T14
```

Tasks dentro de cada grupo podem ser executadas na ordem listada (são sequenciais por arquivo compartilhado em `admin.ts`).

## Verificação final

```bash
cd apps/bot && bunx tsc --noEmit
cd apps/web && bunx tsc --noEmit
cd apps/bot && bunx oxlint src/
cd apps/web && bunx oxlint src/
```

Zero erros novos em ambos os apps.
