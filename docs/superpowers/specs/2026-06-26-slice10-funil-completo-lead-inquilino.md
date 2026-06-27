# Spec — Slice 10: Funil completo lead → inquilino (V1)

**Data:** 2026-06-26
**Status:** aprovado
**Roadmap:** Slice 10 em `ROADMAP.md`

---

## 1. Objetivo

Fechar o funil ponta-a-ponta: lead que entra pelo WhatsApp pode ser convertido em inquilino sem nenhuma ação manual fora do painel admin. Remove gaps de V1 identificados em 2026-06-26.

---

## 2. Fluxo de stages

### Lead.stage (banco)

```
interest → visiting → collection
  → data_confirmation   (bot aguarda confirmação de dados pelo lead)
  → kyc_pending         (owner notificado; aguarda aprovação manual)
  → contract_pending    (contrato auto-gerado e PDF enviado ao lead)
  → converted           (tenant auto-criado; imóvel marcado como alugado)
```

Stages técnicos preservados no enum mas invisíveis no funil de UI: `kyc_approved`, `residents_docs_complete`, `contract_signed`.

### FSM states (LeadContext.state)

Adicionado: `lead.data_confirmation`

---

## 3. Schema — migration

**Arquivo:** `prisma/migrations/20260626000001_contract_lead_relation/migration.sql`

```sql
ALTER TABLE "Contract" ALTER COLUMN "tenantId" DROP NOT NULL;
ALTER TABLE "Contract" ALTER COLUMN "startDate" DROP NOT NULL;
ALTER TABLE "Contract" ADD COLUMN "leadId" TEXT;
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Contract_leadId_idx" ON "Contract"("leadId");
```

**Schema Prisma atualizado:**

```prisma
model Contract {
  tenantId  String?          // era obrigatório — nullable agora
  tenant    Tenant?          @relation(...)
  leadId    String?          // nova FK → Lead.id
  lead      Lead?            @relation(...)
  ...
  @@index([leadId])
}

model Lead {
  contracts  Contract[]     // relação inversa
}
```

Nenhuma outra tabela muda.

---

## 4. CPF — extração e retry

**Regex:** `\d{3}\.?\d{3}\.?\d{3}-?\d{2}`

Aplicada ao `ocrText` de todos os `LeadDocument` do lead (concatenados), retorna o primeiro match.

**Função utilitária:** `extractCpfFromDocs(docs: LeadDocument[]): string | null`

**Fluxo:**

1. Docs + moradores completos → bot tenta extrair CPF
2. **CPF encontrado** → FSM entra em `lead.data_confirmation`; bot envia mensagem de confirmação de dados (nome + CPF) ao lead
3. Lead confirma → `context.dataConfirmed = true` → próxima mensagem → `kyc_pending`
4. **CPF não encontrado** → bot permanece em `lead.collect_application` e envia: *"Não consegui ler o CPF no documento. Pode enviar uma foto mais nítida, com boa iluminação e sem reflexo?"*
5. Lead reenvia imagem → OCR roda novamente → volta ao passo 1

**Reset:** `context.dataConfirmed` volta para `false` se novos documentos forem enviados após confirmação.

---

## 5. Confirmação de visita ao lead

**Trigger:** `leadPatch.scheduledVisitAt` é definido nessa interação E `context.visitConfirmationSent !== true`

**Ação:** `sendText` ao lead imediatamente após persistir:

> *"✅ Visita confirmada! Aguardamos você no dia [DD/MM/AAAA] às [HH:MM] no [nome do imóvel]. Qualquer dúvida, é só chamar!"*

**Flag:** `context.visitConfirmationSent = true` — resetada apenas quando `scheduledVisitAt` muda para um valor diferente do atual (re-agendamento recebe nova confirmação; reprocessamento da mesma mensagem não reenvia)

**Fora do escopo deste slice:** lembretes automáticos pré-visita (ROADMAP Calendário V3).

---

## 6. Notificações — email via Resend

**Config (`config.ts`):**

```ts
RESEND_API_KEY: z.string().optional()
```

**`notify.ts`:**

- Canal email disparado quando `RESEND_API_KEY` presente e `owner.notificationEmail` preenchido
- Se ausente: apenas WhatsApp (comportamento atual mantido)

**Payload `kyc_pending` atualizado:**

```ts
kyc_pending: {
  leadName: string
  leadPhone: string
  cpf: string | null     // novo campo
}
```

**Mensagem WhatsApp ao owner:**

> *"KYC pendente: João Silva (11999999999) — CPF: 123.456.789-00. Acesse o painel para revisar e aprovar."*

**Email ao owner:**

```
Assunto: KYC pendente — João Silva
Corpo:
  Lead: João Silva
  Telefone: (11) 99999-9999
  CPF: 123.456.789-00
  Acesse o painel para revisar os documentos e aprovar o KYC.
```

---

## 7. approve-KYC: auto-contrato + PDF

### Modal no admin (2 passos)

**Passo 1 — Dia de vencimento:**

```
┌─ Aprovar KYC ──────────────────────────┐
│ Dia de vencimento do aluguel: [10]     │
│                                        │
│   [Cancelar]  [Próximo →]              │
└────────────────────────────────────────┘
```

Se nenhum template publicado: botão "Próximo" desabilitado com aviso inline: *"Publique um template em Contratos antes de aprovar."*

**Passo 2 — Variáveis não resolvidas (apenas se houver):**

```
┌─ Variáveis pendentes no contrato ──────────────────┐
│ As seguintes variáveis não foram preenchidas:       │
│                                                     │
│  {{fiador}}        [ Preencher ] [ Remover ]        │
│  {{rg_locatario}}  [ Preencher ] [ Remover ]        │
│                                                     │
│  ou  [ Ignorar todas ]                              │
│                                                     │
│  [← Voltar]        [Confirmar e aprovar]            │
└─────────────────────────────────────────────────────┘
```

- **Preencher** → campo de texto inline substitui o placeholder
- **Remover** → placeholder removido do corpo do contrato
- **Ignorar** → placeholder substituído por `N/A`

Nenhum `{{placeholder}}` visível chega ao PDF final.

### Lógica do endpoint `POST /admin/leads/:id/approve-kyc`

1. Validação: `lead.stage === 'kyc_pending'` (409 se diferente)
2. Busca template com `status = 'published'` mais recente por `updatedAt DESC` (409 se nenhum)
3. Auto-resolve variáveis com dados disponíveis:

| Variável | Fonte |
|---|---|
| `{{locatario}}` | `lead.name` |
| `{{cpf_locatario}}` | CPF extraído do OCR |
| `{{telefone_locatario}}` | `lead.phone` |
| `{{imovel}}` | `property.name` |
| `{{endereco}}` | `property.address + complement` |
| `{{bairro}}` | `property.neighborhood` |
| `{{aluguel}}` | `property.rent` (formatado BRL) |
| `{{deposito}}` | `property.deposit` (formatado BRL) |
| `{{data_hoje}}` | hoje |
| `{{data_assinatura}}` | `"A ser preenchida na assinatura"` |
| `{{vencimento}}` | `paymentDayOfMonth` do modal |

4. Aplica resoluções manuais do passo 2 do modal (preencher / remover / N/A)
5. Cria `Contract`:
   - `leadId = lead.id`
   - `tenantId = null`
   - `propertyId = lead.propertyId`
   - `templateId = template.id`
   - `body = rendered`
   - `status = 'draft'`
   - `startDate = null` (preenchido no mark-signed)
   - `monthlyRent = property.rent`
6. Gera PDF → upload Storage → `contract.pdfUrl`
7. `sendMedia` ao lead: PDF + *"Segue seu contrato para revisão. Qualquer dúvida, é só chamar!"*
8. `lead.stage → contract_pending`
9. Activity log: `contract_auto_created`, `contract_pdf_sent`

**Body do request:**

```ts
{
  paymentDayOfMonth: number          // 1–28
  manualVariables?: Record<string, string | null>  // null = remover; 'N/A' = ignorar
}
```

---

## 8. mark-signed: auto-criação do Tenant

### Lógica do endpoint `POST /admin/leads/:id/mark-signed`

1. Validação: `lead.stage === 'contract_pending'` (409 se diferente)
2. Extrai CPF do OCR (mesmo `extractCpfFromDocs`)
3. Gera `externalId` via `nextExternalId('tenant')`
4. Cria `Tenant`:

| Campo | Valor |
|---|---|
| `phone` | `lead.phone` |
| `name` | `lead.name` |
| `cpf` | CPF extraído (identificador único) |
| `propertyId` | `lead.propertyId` |
| `contractStart` | hoje |
| `externalId` | gerado |
| `ownerId` | `lead.ownerId` |

5. Atualiza `Contract` (o que tem `leadId = lead.id`):
   - `tenantId = tenant.id`
   - `startDate = hoje`
   - `status = 'active'`
6. Regenera PDF com `{{data_assinatura}}` → data de hoje
7. `property.status = 'rented'`, `property.active = false`
8. `lead.stage → converted`
9. `sendMedia` ao lead: PDF final + *"✅ Contrato assinado! Aqui está sua cópia com a data de início preenchida."*
10. `notifyOwner`: WhatsApp + email — *"Contrato assinado por [nome]. Lead convertido em inquilino [IQ-XXX]."*
11. Activity log: `tenant_auto_created`, `contract_signed`

---

## 9. Web UI — stage stepper + ações

### Stepper atualizado

```
Interesse → Visita → Documentos → KYC → Contrato → Convertido
```

Mapeamento de stages para steps:

| Stage(s) | Step visível |
|---|---|
| `interest` | Interesse |
| `visiting` | Visita |
| `collection`, `data_confirmation` | Documentos |
| `kyc_pending` | KYC |
| `contract_pending` | Contrato |
| `converted` | Convertido |

### Botões de ação por stage

| Stage | Ação | Comportamento |
|---|---|---|
| `kyc_pending` | "Aprovar KYC" | Abre modal 2 passos |
| `contract_pending` | "Marcar assinado" | Chama mark-signed, auto-cria tenant |

**Removidos:** botão "Gerar Contrato" separado, botão "Confirmar Pagamento" do funil de lead.

### Modal approve-KYC (web)

- Passo 1: input numérico `paymentDayOfMonth` (1–28, default 10)
- Passo 2 (condicional): lista de variáveis não resolvidas com ações inline
- Botão "Confirmar e aprovar" chama `POST /admin/leads/:id/approve-kyc`

---

## 10. Fora do escopo deste slice

- Assinatura digital (Autentique, Clicksign) — V2
- Notificação in-app (badge sidebar) — V2
- Lembretes automáticos pré-visita — ROADMAP Calendário V3
- Validação de CPF na Receita Federal — V2
- Fluxo de tenant (manutenção, ServiceProvider, boleto) — V2
