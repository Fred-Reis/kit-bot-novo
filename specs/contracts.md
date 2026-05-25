# Spec: Slice 5 — Contracts (PDF + resolução de variáveis)

> Sliced de [ROADMAP.md](../ROADMAP.md) Fase 1, Slice 5.
> Depende de: Slices 1–4, Foundation F0.2 (logActivity helper), F0.4 (notifyOwner helper).
> Pipeline: /spec → /plan → /build → /simplify → /review → COMMIT.

---

## 1. Objetivo

Completar a feature de contratos ponta-a-ponta:

1. **Resolução de variáveis** — ao criar contrato, o owner vê quais `{{variáveis}}` do template foram auto-mapeadas e quais precisam de associação manual ou preenchimento livre; o contrato só é criado com todas as variáveis resolvidas.
2. **Geração de PDF** — endpoint real que gera PDF via pdfkit, faz upload para Supabase Storage e retorna URL pública; cached em `Contract.pdfUrl`.
3. **Marcar contrato assinado** — ação no detalhe do lead que move `Lead.stage` de `contract_pending` → `contract_signed`, emite activity log e notifica owner via WhatsApp.

**Usuário alvo:** proprietário logado no admin (apps/web).

**Sucesso:** owner cria contrato com variáveis todas resolvidas, baixa PDF funcional e marca o contrato como assinado pelo tenant.

---

## 2. Escopo

### Dentro

- Schema: `Contract.pdfUrl String?` (migration + Prisma + tipo)
- Bot: `services/pdf.ts` — gera PDF com pdfkit, upload Storage, retorna URL
- Bot: novo endpoint `POST /admin/contracts/preview` — auto-mapeia variáveis conhecidas, retorna `resolved`, `unresolved`, `suggestions`
- Bot: atualizar `POST /admin/contracts` — aceitar `variables: Record<string, string>`, substituir no body antes de persistir, emitir `contract_created`
- Bot: atualizar `GET /admin/contracts/:id/pdf` — substituir stub 501 por geração real + cache em `pdfUrl`
- Bot: novo endpoint `POST /admin/leads/:id/mark-signed` — mover `Lead.stage` para `contract_signed`, emitir log, notificar owner
- Web: `NewContractModal` em dois steps (step 1: dados; step 2: resolução de variáveis)
- Web: `$contractId.tsx` — botão "Baixar PDF" funcional (chama endpoint, abre URL)
- Web: `$leadId.tsx` — botão "Marcar contrato assinado" quando `stage === 'contract_pending'`
- Web: `lib/api.ts` — adicionar `previewContract`, atualizar `createContract`, adicionar `getContractPdf`, `markContractSigned`
- Activity log: `contract_created`, `contract_signed`
- Notif: WhatsApp ao owner em `contract_signed`
- ROADMAP: marcar Slice 5 como `[x]`

### Fora

- Assinatura digital (Autentique) — Fase 6
- Envio do PDF pelo bot via WhatsApp ao tenant (fora do MVP desta slice)
- Renovação automática de contrato
- Geração de DOCX/Word
- Histórico de versões do body do contrato
- Paginação ou busca na lista de contratos
- Testes de integração com banco real
- RLS

---

## 3. Schema changes

### Migration: `contracts_slice_add_pdf_url`

```sql
ALTER TABLE "Contract" ADD COLUMN "pdfUrl" TEXT;
```

Sem backfill necessário — contratos existentes não têm PDF gerado; `pdfUrl` fica `NULL` até o primeiro download.

**Prisma schema (`apps/bot/prisma/schema.prisma`):**

```prisma
model Contract {
  id          String           @id @default(uuid())
  ownerId     String
  owner       Owner            @relation(fields: [ownerId], references: [id], onDelete: Restrict)
  code        String           @unique
  templateId  String
  template    ContractTemplate @relation(fields: [templateId], references: [id])
  tenantId    String
  tenant      Tenant           @relation(fields: [tenantId], references: [id])
  propertyId  String
  property    Property         @relation(fields: [propertyId], references: [id])
  body        String
  status      String           @default("active")
  pdfUrl      String?
  startDate   DateTime
  endDate     DateTime?
  monthlyRent Decimal
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  @@index([ownerId])
}
```

---

## 4. Tipos compartilhados (`packages/types`)

**`packages/types/src/contract.ts`** — adicionar `pdfUrl` e tipos de preview:

```ts
export interface Contract {
  id: string;
  ownerId: string;
  code: string;
  templateId: string;
  tenantId: string;
  propertyId: string;
  body: string;
  status: 'active' | 'terminated' | 'renewal';
  pdfUrl: string | null;            // novo
  startDate: string;
  endDate: string | null;
  monthlyRent: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContractDetail extends Contract {
  tenant: { name: string | null; phone: string };
  property: { name: string };
}

export interface ContractSummary {
  id: string;
  code: string;
  status: 'active' | 'terminated' | 'renewal';
  startDate: string;
  endDate: string | null;
  monthlyRent: number;
  tenant: { name: string | null };
  property: { name: string };
}

// novo — retorno do endpoint /preview
export interface ContractPreview {
  resolved: Record<string, string>;         // variáveis auto-mapeadas: { "{{locador}}": "João Silva" }
  unresolved: string[];                     // variáveis sem mapeamento automático: ["{{fiador}}", "{{cnh}}"]
  suggestions: ContractVariableSuggestion[]; // campos disponíveis para associar manualmente
}

export interface ContractVariableSuggestion {
  field: string;   // ex: "tenant.cpf"
  label: string;   // ex: "CPF do inquilino"
  value: string;   // ex: "123.456.789-00"
}
```

---

## 5. Bot changes

### 5.1 — `services/pdf.ts` (novo)

Serviço que gera PDF a partir do `body` do contrato e faz upload para Supabase Storage.

```ts
import PDFDocument from 'pdfkit';
import { Readable } from 'stream';
import { supabase } from '@/db/supabase-client'; // cliente service_role

export async function generateAndUploadPdf(
  contractId: string,
  body: string,
  code: string,
): Promise<string> {
  const buffer = await renderPdf(body, code);
  const path = `contracts/${contractId}.pdf`;

  const { error } = await supabase.storage
    .from('kit-manager')                        // bucket existente ou criar 'contracts'
    .upload(path, buffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from('kit-manager').getPublicUrl(path);
  return data.publicUrl;
}

function renderPdf(body: string, code: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 72, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(`CONTRATO DE LOCAÇÃO — ${code}`, { align: 'center' });
    doc.moveDown();
    doc.font('Helvetica').fontSize(10).text(body, { align: 'justify', lineGap: 4 });
    doc.end();
  });
}
```

**Observação:** `pdfkit` precisa ser adicionado como dependência em `apps/bot/package.json`.

### 5.2 — `POST /admin/contracts/preview` (novo endpoint)

Recebe os dados do formulário, busca template/tenant/property/owner, auto-mapeia variáveis conhecidas e retorna o que está resolvido e o que precisa de input manual.

```
POST /admin/contracts/preview
Body: { templateId, tenantId, propertyId, startDate, endDate?, monthlyRent }
Auth: JWT admin
```

**Mapeamento automático de variáveis conhecidas:**

| Variável no template | Valor |
|---|---|
| `{{locador}}` | `owner.name` |
| `{{locatário}}` / `{{locatario}}` | `tenant.name ?? tenant.phone` |
| `{{cpf}}` / `{{cpf_locatário}}` | `tenant.cpf ?? ''` |
| `{{email_locatário}}` | `tenant.email ?? ''` |
| `{{telefone_locatário}}` | `tenant.phone` |
| `{{imóvel}}` / `{{imovel}}` | `property.name` |
| `{{endereço}}` / `{{endereco}}` | `[property.address, property.complement].filter(Boolean).join(', ')` |
| `{{bairro}}` | `property.neighborhood` |
| `{{aluguel}}` | `formatBRL(monthlyRent)` |
| `{{depósito}}` / `{{deposito}}` | `formatBRL(property.deposit)` |
| `{{início}}` / `{{inicio}}` | `formatDate(startDate)` — dd/mm/yyyy |
| `{{fim}}` | `formatDate(endDate)` ou `'Indeterminado'` |
| `{{prazo}}` | meses entre startDate e endDate (ou `'Indeterminado'`) |
| `{{data_hoje}}` | `formatDate(new Date())` |

> **Normalização de chave:** antes de comparar, normalizar para lowercase sem acentos (ex: `{{Locatário}}` → `locatário` → match em `locatário`).

**Suggestions (para variáveis não resolvidas):** lista fixa de campos disponíveis com seus valores atuais, para que o owner escolha a associação:

```ts
const suggestions: ContractVariableSuggestion[] = [
  { field: 'owner.name',          label: 'Nome do proprietário',  value: owner.name },
  { field: 'tenant.name',         label: 'Nome do inquilino',     value: tenant.name ?? '' },
  { field: 'tenant.cpf',          label: 'CPF do inquilino',      value: tenant.cpf ?? '' },
  { field: 'tenant.phone',        label: 'Telefone do inquilino', value: tenant.phone },
  { field: 'tenant.email',        label: 'E-mail do inquilino',   value: tenant.email ?? '' },
  { field: 'property.name',       label: 'Nome do imóvel',        value: property.name },
  { field: 'property.address',    label: 'Endereço',              value: property.address },
  { field: 'property.neighborhood', label: 'Bairro',              value: property.neighborhood },
  { field: 'property.deposit',    label: 'Depósito',              value: formatBRL(property.deposit) },
  { field: 'contract.monthlyRent', label: 'Aluguel mensal',       value: formatBRL(monthlyRent) },
  { field: 'contract.startDate',  label: 'Data de início',        value: formatDate(startDate) },
  { field: 'contract.endDate',    label: 'Data de fim',           value: endDate ? formatDate(endDate) : 'Indeterminado' },
];
```

**Response:**
```ts
{
  resolved: { '{{locador}}': 'João Silva', '{{aluguel}}': 'R$ 1.500,00', ... },
  unresolved: ['{{fiador}}', '{{cnh}}'],
  suggestions: [ /* lista acima com valores preenchidos */ ],
}
```

### 5.3 — `POST /admin/contracts` (atualizar)

Adicionar `variables: Record<string, string>` ao body. Substituir no template body antes de persistir. Emitir `contract_created`.

```ts
// body inclui: templateId, tenantId, propertyId, startDate, endDate?, monthlyRent, variables
const { templateId, tenantId, propertyId, startDate, endDate, monthlyRent, variables } = request.body;

// ... fetch template, tenant, property (já existente) ...

// substituir variáveis no body
let renderedBody = template.body;
for (const [placeholder, value] of Object.entries(variables ?? {})) {
  renderedBody = renderedBody.replaceAll(placeholder, value);
}

const contract = await prisma.contract.create({
  data: {
    code,
    ownerId: property.ownerId,
    templateId,
    tenantId,
    propertyId,
    body: renderedBody,  // body renderizado
    status: 'active',
    startDate: new Date(startDate),
    endDate: endDate ? new Date(endDate) : null,
    monthlyRent,
  },
});

// activity log (fire-and-forget)
logActivity(
  request.adminUserId ?? 'admin',
  property.ownerId,
  'contract_created',
  contract.code,
  contract.id,
  'contract',
  fastify.log.warn.bind(fastify.log),
);

return reply.status(201).send(contract);
```

### 5.4 — `GET /admin/contracts/:id/pdf` (substituir stub)

```ts
fastify.get('/admin/contracts/:id/pdf', { preHandler: verifyAdminJwt }, async (request, reply) => {
  const { id } = request.params;
  const contract = await prisma.contract.findUnique({
    where: { id },
    select: { id: true, code: true, body: true, pdfUrl: true },
  });
  if (!contract) return reply.status(404).send({ error: 'Contract not found' });

  // cache hit
  if (contract.pdfUrl) return reply.send({ url: contract.pdfUrl });

  // gerar e cachear
  const url = await generateAndUploadPdf(contract.id, contract.body, contract.code);
  await prisma.contract.update({ where: { id }, data: { pdfUrl: url } });

  return reply.send({ url });
});
```

### 5.5 — `POST /admin/leads/:id/mark-signed` (novo endpoint)

```ts
fastify.post('/admin/leads/:id/mark-signed', { preHandler: verifyAdminJwt }, async (request, reply) => {
  const { id } = request.params;
  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { stage: true, name: true, phone: true, ownerId: true },
  });
  if (!lead) return reply.status(404).send({ error: 'Lead not found' });
  if (lead.stage !== 'contract_pending') {
    return reply.status(409).send({
      error: `Lead is in stage '${lead.stage}', expected 'contract_pending'`,
    });
  }

  await prisma.lead.update({ where: { id }, data: { stage: 'contract_signed' } });

  // activity log (fire-and-forget)
  logActivity(
    request.adminUserId ?? 'admin',
    lead.ownerId,
    'contract_signed',
    lead.name ?? lead.phone,
    id,
    'lead',
    fastify.log.warn.bind(fastify.log),
  );

  // notif owner
  notifyOwner(lead.ownerId, 'contract_signed', {
    leadName: lead.name ?? lead.phone,
  }).catch((err: unknown) => fastify.log.warn({ err }, 'Failed to notify owner on contract_signed'));

  return reply.send({ success: true, stage: 'contract_signed' });
});
```

---

## 6. Web changes

### 6.1 — `NewContractModal` em dois steps (`contracts/index.tsx`)

**Step 1** (já existe): templateId, tenantId, propertyId, startDate, endDate, monthlyRent.

Botão de avanço: "Próximo →" (só habilitado quando todos os campos obrigatórios preenchidos). Ao clicar: chama `adminApi.previewContract(form)` → mostra spinner → vai para step 2.

**Step 2** (novo): resolução de variáveis.

Layout:
- Título: "Variáveis do contrato"
- Seção "Mapeadas automaticamente" (se houver): lista read-only de `{{var}}` → valor (muted)
- Seção "Precisam de associação" (se houver): para cada `unresolved`:
  - Label com o nome do placeholder (`{{fiador}}`)
  - Select dropdown com as `suggestions` (campo → valor) + opção "Preencher manualmente"
  - Se "Preencher manualmente" selecionado: input text aparece abaixo
- Botão "← Voltar" (volta para step 1 sem perder dados)
- Botão "Criar contrato" — habilitado só quando todas as `unresolved` têm valor definido

Ao criar: `adminApi.createContract({ ...form, variables: resolvedMap })` onde `resolvedMap` é o merge de `resolved` (do preview) + resoluções manuais do step 2, no formato `{ '{{var}}': 'valor' }`.

### 6.2 — `$contractId.tsx` — botão "Baixar PDF" funcional

Substituir `toast.info('Em breve')` por chamada real:

```ts
const [downloading, setDownloading] = useState(false);

async function handleDownload() {
  setDownloading(true);
  try {
    const { data } = await adminApi.getContractPdf(contractId);
    window.open(data.url, '_blank');
  } catch {
    toast.error('Falha ao gerar PDF');
  } finally {
    setDownloading(false);
  }
}
```

Botão mostra `downloading ? 'Gerando…' : 'Baixar PDF'`.

### 6.3 — `$leadId.tsx` — botão "Marcar contrato assinado"

Quando `lead.stage === 'contract_pending'`, exibir botão na área de ações do detalhe do lead:

```tsx
{lead.stage === 'contract_pending' && (
  <CustomButton
    variant="primary"
    size="sm"
    disabled={markSignedMutation.isPending}
    onClick={() => markSignedMutation.mutate()}
  >
    Marcar contrato assinado
  </CustomButton>
)}
```

`markSignedMutation`:
- `mutationFn`: `adminApi.markContractSigned(leadId)`
- `onSuccess`: `qc.invalidateQueries({ queryKey: ['lead', leadId] })` + `toast.success('Contrato marcado como assinado')`
- `onError`: `toast.error('Falha ao marcar contrato')`

### 6.4 — `lib/api.ts` — novos métodos

```ts
previewContract: (data: {
  templateId: string;
  tenantId: string;
  propertyId: string;
  startDate: string;
  endDate?: string;
  monthlyRent: number;
}) => botApi.post<ContractPreview>('/admin/contracts/preview', data),

// atualizar createContract para aceitar variables
createContract: (data: {
  templateId: string;
  tenantId: string;
  propertyId: string;
  startDate: string;
  endDate?: string;
  monthlyRent: number;
  variables: Record<string, string>;
}) => botApi.post('/admin/contracts', data),

getContractPdf: (contractId: string) =>
  botApi.get<{ url: string }>(`/admin/contracts/${contractId}/pdf`),

markContractSigned: (leadId: string) =>
  botApi.post(`/admin/leads/${leadId}/mark-signed`),
```

---

## 7. Activity log keys

| Evento | actorType | subjectType | Gatilho |
|---|---|---|---|
| `contract_created` | `user` | `contract` | Bot: `POST /admin/contracts` — após criar |
| `contract_signed` | `user` | `lead` | Bot: `POST /admin/leads/:id/mark-signed` — após mudar stage |

---

## 8. Notificações

| Evento | Canal | Mensagem |
|---|---|---|
| `contract_signed` | WhatsApp (owner) | `"✅ Contrato assinado por {leadName}. Próximo passo: confirmar pagamento."` |

Via `notifyOwner(ownerId, 'contract_signed', { leadName })` — fire-and-forget.

---

## 9. Critérios de aceite

### Schema & migration
- [ ] Migration aplicada: coluna `pdfUrl TEXT` adicionada em `Contract`
- [ ] `prisma generate` OK sem erros

### Bot — preview
- [ ] `POST /admin/contracts/preview` retorna `resolved`, `unresolved`, `suggestions`
- [ ] Variáveis conhecidas (`{{locador}}`, `{{aluguel}}`, etc.) aparecem em `resolved` com valores corretos
- [ ] Variável não mapeada aparece em `unresolved`
- [ ] `suggestions` lista todos os campos disponíveis com valores do banco
- [ ] Normalização de chave funciona: `{{Locatário}}` e `{{locatario}}` são resolvidos como a mesma variável
- [ ] `bunx tsc --noEmit` verde em `apps/bot`

### Bot — create contract
- [ ] `POST /admin/contracts` aceita `variables: Record<string, string>`
- [ ] Body salvo no banco tem variáveis substituídas (sem `{{...}}` residual para variáveis passadas no map)
- [ ] Activity log `contract_created` emitido (fire-and-forget)
- [ ] Falha no log não quebra o endpoint

### Bot — PDF
- [ ] `GET /admin/contracts/:id/pdf` não retorna mais 501
- [ ] Primeira chamada: gera PDF, faz upload para Storage, salva `pdfUrl`, retorna `{ url }`
- [ ] Segunda chamada: retorna `pdfUrl` cacheado sem regenerar
- [ ] PDF gerado é um arquivo válido (não 0 bytes, abre em PDF reader)
- [ ] `bunx tsc --noEmit` verde em `apps/bot`

### Bot — mark-signed
- [ ] `POST /admin/leads/:id/mark-signed` move stage de `contract_pending` → `contract_signed`
- [ ] Retorna 409 se lead não está em `contract_pending`
- [ ] Activity log `contract_signed` emitido
- [ ] Notificação WhatsApp disparada (fire-and-forget)

### Web — modal dois steps
- [ ] Step 1 → Step 2 só avança com todos os campos obrigatórios preenchidos
- [ ] Step 2 mostra variáveis mapeadas automaticamente (read-only)
- [ ] Variáveis não mapeadas têm dropdown de sugestões + opção "Preencher manualmente"
- [ ] "Criar contrato" só habilita quando todas as `unresolved` têm valor
- [ ] Contrato criado tem body com variáveis substituídas (verificar via detalhe do contrato)
- [ ] `bunx tsc --noEmit` verde em `apps/web`

### Web — PDF download
- [ ] Botão "Baixar PDF" chama endpoint e abre URL em nova aba
- [ ] Botão mostra estado de loading durante a chamada
- [ ] Toast de erro em caso de falha

### Web — mark-signed
- [ ] Botão "Marcar contrato assinado" aparece no detalhe do lead quando `stage === 'contract_pending'`
- [ ] Botão NÃO aparece em outros stages
- [ ] Após marcar: lead atualizado na UI, toast de sucesso
- [ ] `bunx tsc --noEmit` verde em `apps/web`

### Lint
- [ ] `bunx oxlint` — 0 novos warnings em ambos apps

### ROADMAP
- [ ] Todos os itens da Slice 5 marcados `[x]` no ROADMAP

---

## 10. Riscos / edge cases

### R1 — `pdfkit` não instalado
`pdfkit` precisa ser adicionado como dep em `apps/bot/package.json` (`bun add pdfkit` + `bun add -d @types/pdfkit`).
**Mitigação:** T1 do plan inclui `bun add`.

### R2 — Bucket Storage
O bucket `kit-manager` pode não ter a pasta `contracts/` com permissões corretas, ou pode não existir.
**Mitigação:** verificar bucket existente via Supabase dashboard antes de buildar; o código usa `upsert: true` então não falha em re-upload.

### R3 — Normalização de variáveis com acento
`{{locatário}}` e `{{locatario}}` devem ser tratados como a mesma chave. Normalização no preview com `str.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()`.
**Mitigação:** implementar `normalizeKey(s: string)` utilitário, usar nos dois lados (mapeamento e substituição).

### R4 — `POST /admin/contracts/preview` vs `POST /admin/contracts`
O endpoint `/preview` deve ser registrado **antes** de `/contracts` no Fastify, pois ambos são `POST /admin/contracts/...`. Fastify usa match por ordem; `/preview` como path literal não conflita com `/contracts` (são paths diferentes), mas cuidar na ordem de registro.
**Mitigação:** registrar `/preview` antes do create na função `adminRoutes`.

### R5 — `variables` vazio ou undefined no create
Se o client enviar sem `variables` (contrato sem nenhuma variável no template), `renderedBody` deve ser igual ao `template.body` original.
**Mitigação:** `for (const [k, v] of Object.entries(variables ?? {}))` — loop não executa se map vazio.

### R6 — PDF gerado de body longo
pdfkit pode extrapolar a página para contratos muito longos.
**Mitigação:** pdfkit suporta múltiplas páginas automaticamente quando `text()` é chamado com `lineGap`. Sem limite de páginas no MVP.

### R7 — `notifyOwner` sem `notificationPhone`
Se `Owner.notificationPhone` for null, `notifyOwner` deve ser no-op silencioso.
**Mitigação:** `services/notify.ts` já trata isso (padrão estabelecido nas slices anteriores).

### R8 — Contrato sem variáveis no template
Template com body sem nenhum `{{...}}`: `unresolved = []`, `resolved = {}`. Modal step 2 exibe "Nenhuma variável encontrada — pronto para criar." e habilita diretamente o botão de criar.
**Mitigação:** tratar no step 2 do modal.

---

## 11. Dependências / pré-condições

- Foundation F0.2 aplicada: `logActivity` helper em `services/activity.ts`
- Foundation F0.4 parcial: `notifyOwner` em `services/notify.ts` (WhatsApp funcional)
- Slices 1–4 aplicadas (padrão de admin routes e web estabelecido)
- Bucket Supabase Storage disponível e acessível com `SUPABASE_SERVICE_KEY`
- `pdfkit` instalado em `apps/bot`

---

## 12. Out of scope (explícito)

- Envio do PDF pelo bot via WhatsApp ao tenant
- Assinatura digital (Autentique)
- Webhook de assinatura
- Regenar PDF ao editar contrato
- Download de DOCX
- Preview do PDF na UI (embed `<iframe>`)
- Renovação de contrato
- Rescisão com cálculo de multa
- Histórico de variáveis resolvidas por contrato
