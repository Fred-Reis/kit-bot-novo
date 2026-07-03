# Lead Flow v2 — Fase A: Pipeline determinístico de docs + checklist — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Documentos de leads processados por pipeline 100% determinístico (OCR → classificação → persistência tipada → resposta de checklist), coleta flexível (renda declarada, moradores por quantidade) e escalação para humano — sem LLM no caminho crítico.

**Architecture:** Bot WhatsApp Fastify/Bun (`apps/bot`). Hoje: mensagem → `flows/lead/index.ts` → extractor LLM → FSM (`context.ts: deriveState`) → router LLM → agente LLM. Docs são contados às cegas (`count(LeadDocument)`). Esta fase cria módulos novos (`doc-classifier`, `checklist`, `doc-intake`, `escalation`) e rewira `index.ts` para que o funil crítico (docs → renda → moradores → confirmação → KYC) seja dirigido pelo banco, não por booleans extraídos por LLM. Spec: `docs/lead-flow-v2.md` §2.4–2.8.

**Tech Stack:** Bun + TypeScript strict, Fastify, Prisma (PostgreSQL/Supabase), Google Cloud Vision (OCR REST), LangChain JS + GPT-4o mini (conversa apenas), `bun test`.

## Global Constraints

- Usar **bun**; comandos a partir de `apps/bot/`. Typecheck `bunx tsc --noEmit`; testes `bun test`; lint `bunx oxlint src`.
- Imports com alias `@/`. **Não usar Python.** Mensagens ao lead em pt-BR, cordiais e curtas.
- **CONTRATO CONGELADO:** as assinaturas de `doc-classifier.ts`, `checklist.ts` e `escalation.ts` são consumidas pela Fase B (plan separado). Não renomear sem atualizar `2026-07-02-lead-flow-v2-README.md` e o plan da Fase B.
- **Git em duas branches/PRs:**
  - Tasks 2 e 3 (classifier + checklist) na branch `feat/lead-flow-v2-contract` (criada de `main`) → PR imediata — é o contrato que desbloqueia a Fase B em paralelo.
  - Tasks 1 e 4–10 na branch `feat/lead-flow-v2-fase-a`, criada de `main` **após a PR do contrato ser mergeada** (ou de `feat/lead-flow-v2-contract` se o Fred ainda não mergeou — rebase depois).
  - Push + `gh pr create` ao final de cada bloco (steps de PR nas tasks 3 e 10). **Nunca commitar/pushar em `main`; merge é do Fred via PR.**
- Fase 0 (plan separado) já deve estar aplicada: `persistLeadDocuments` retorna `Promise<number>` e existe `flows/lead/receipt.ts`. A Task 5 desta fase **substitui** ambos.
- Timezone de exibição: `America/Sao_Paulo`.

---

### Task 1: Migration — `declaredIncome`, `expectedResidents`, tabela `LeadResident`

**Files:**
- Modify: `apps/bot/prisma/schema.prisma` (models `Lead` e `Owner`; novo model `LeadResident`)
- Create: `apps/bot/prisma/migrations/<gerada>/migration.sql` (via prisma)

**Interfaces:**
- Produces: `prisma.leadResident` client; campos `lead.declaredIncome: Decimal | null`, `lead.expectedResidents: number | null`. Consumidos pelas Tasks 3, 8, 9.

- [ ] **Step 1: Editar `schema.prisma`**

No model `Lead`, adicionar após `scheduledVisitAt DateTime?`:

```prisma
  declaredIncome    Decimal?
  expectedResidents Int?
  residents         LeadResident[]
```

No model `Owner`, adicionar à lista de relations (após `leadDocuments LeadDocument[]`):

```prisma
  leadResidents     LeadResident[]
```

Novo model (após `LeadDocument`):

```prisma
model LeadResident {
  id        String   @id @default(uuid())
  ownerId   String
  owner     Owner    @relation(fields: [ownerId], references: [id], onDelete: Restrict)
  leadId    String
  lead      Lead     @relation(fields: [leadId], references: [id], onDelete: Cascade)
  name      String
  sex       String?
  age       Int?
  createdAt DateTime @default(now())

  @@index([ownerId])
  @@index([leadId])
}
```

- [ ] **Step 2: Gerar e aplicar a migration**

Run: `cd apps/bot && bunx prisma migrate dev --name lead_flow_v2_checklist`
Expected: migration criada em `prisma/migrations/`, client regenerado, banco de dev atualizado.

- [ ] **Step 3: Typecheck**

Run: `cd apps/bot && bunx tsc --noEmit`
Expected: sem erros

- [ ] **Step 4: Commit**

```bash
git add apps/bot/prisma/
git commit -m "schema: adicionar declaredIncome, expectedResidents e LeadResident"
```

---

### Task 2: Classificador determinístico de documentos (CONTRATO)

**Files:**
- Create: `apps/bot/src/services/doc-classifier.ts`
- Test: `apps/bot/src/__tests__/doc-classifier.test.ts`

**Interfaces:**
- Produces (congelado — Fase B importa):

```ts
export type LeadDocumentType =
  | 'cnh_front' | 'cnh_back' | 'cnh_full'
  | 'rg_front' | 'rg_back' | 'cpf'
  | 'income_proof' | 'unknown';
export function classifyDocument(ocrText: string): LeadDocumentType;
export const DOC_TYPE_LABEL: Record<LeadDocumentType, string>;
```

- [ ] **Step 1: Escrever os testes que falham**

```ts
// apps/bot/src/__tests__/doc-classifier.test.ts
import { describe, expect, it } from 'bun:test';
import { classifyDocument } from '@/services/doc-classifier';

const CNH_FRONT = `CARTEIRA NACIONAL DE HABILITAÇÃO
NOME FREDERICO LOPES
DOC. IDENTIDADE 12345678 SSP GO
CPF 123.456.789-00 DATA NASCIMENTO 01/01/1990
FILIAÇÃO MARIA LOPES
CAT. HAB. B  Nº REGISTRO 01234567890  VALIDADE 10/10/2030`;

const CNH_BACK = `OBSERVAÇÕES
LOCAL
GOIÂNIA, GO
DATA EMISSÃO 10/10/2020
ASSINATURA DO EMISSOR`;

const CNH_FULL = `${CNH_FRONT}\n${CNH_BACK}`;

const RG_BACK = `REGISTRO GERAL 12.345.678-9 DATA DE EXPEDIÇÃO 05/05/2015
NOME FREDERICO LOPES
FILIAÇÃO MARIA LOPES / JOSÉ LOPES
NATURALIDADE GOIÂNIA GO
CPF 123.456.789-00`;

const RG_FRONT = `REPÚBLICA FEDERATIVA DO BRASIL
SECRETARIA DE SEGURANÇA PÚBLICA
CARTEIRA DE IDENTIDADE`;

const CPF_CARD = `MINISTÉRIO DA FAZENDA
CADASTRO DE PESSOAS FÍSICAS
NÚMERO DE INSCRIÇÃO 123.456.789-00
NOME FREDERICO LOPES`;

const HOLERITE = `DEMONSTRATIVO DE PAGAMENTO
EMPRESA X LTDA  CNPJ 00.000.000/0001-00
FUNCIONÁRIO FREDERICO LOPES CPF 123.456.789-00
SALÁRIO BASE 12.000,00  TOTAL LÍQUIDO 10.500,00`;

describe('classifyDocument', () => {
  it('CNH frente', () => expect(classifyDocument(CNH_FRONT)).toBe('cnh_front'));
  it('CNH verso', () => expect(classifyDocument(CNH_BACK)).toBe('cnh_back'));
  it('CNH aberta em foto única', () => expect(classifyDocument(CNH_FULL)).toBe('cnh_full'));
  it('RG verso (lado dos dados)', () => expect(classifyDocument(RG_BACK)).toBe('rg_back'));
  it('RG frente', () => expect(classifyDocument(RG_FRONT)).toBe('rg_front'));
  it('CPF', () => expect(classifyDocument(CPF_CARD)).toBe('cpf'));
  it('comprovante de renda antes de CPF (holerite tem CPF no texto)', () =>
    expect(classifyDocument(HOLERITE)).toBe('income_proof'));
  it('texto vazio → unknown', () => expect(classifyDocument('')).toBe('unknown'));
  it('foto aleatória → unknown', () => expect(classifyDocument('gato deitado no sofá')).toBe('unknown'));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/bot && bun test doc-classifier`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
// apps/bot/src/services/doc-classifier.ts
export type LeadDocumentType =
  | 'cnh_front'
  | 'cnh_back'
  | 'cnh_full'
  | 'rg_front'
  | 'rg_back'
  | 'cpf'
  | 'income_proof'
  | 'unknown';

export const DOC_TYPE_LABEL: Record<LeadDocumentType, string> = {
  cnh_front: 'frente da CNH',
  cnh_back: 'verso da CNH',
  cnh_full: 'CNH completa (foto única)',
  rg_front: 'frente do RG',
  rg_back: 'verso do RG',
  cpf: 'CPF',
  income_proof: 'comprovante de renda',
  unknown: 'documento não identificado',
};

const CPF_NUMBER = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/;

function norm(value: string): string {
  return value.toUpperCase().normalize('NFKD').replace(/\p{M}/gu, '');
}

export function classifyDocument(ocrText: string): LeadDocumentType {
  const t = norm(ocrText);
  if (!t.trim()) return 'unknown';

  const cnhHeader = t.includes('CARTEIRA NACIONAL DE HABILITACAO') || t.includes('PERMISSAO PARA DIRIGIR');
  const cnhFrontMarkers =
    t.includes('CAT. HAB') || t.includes('CAT HAB') || (t.includes('FILIACAO') && t.includes('REGISTRO'));
  const cnhBackMarkers = t.includes('OBSERVACOES') && (t.includes('LOCAL') || t.includes('EMISSAO'));

  if (cnhHeader && cnhBackMarkers) return 'cnh_full';
  if (cnhHeader || cnhFrontMarkers) return 'cnh_front';
  if (cnhBackMarkers) return 'cnh_back';

  const incomeMarkers =
    t.includes('DEMONSTRATIVO DE PAGAMENTO') ||
    t.includes('HOLERITE') ||
    t.includes('CONTRACHEQUE') ||
    t.includes('RECIBO DE PAGAMENTO') ||
    (t.includes('SALARIO') && t.includes('LIQUIDO')) ||
    t.includes('EXTRATO');
  if (incomeMarkers) return 'income_proof';

  const rgHeader =
    t.includes('REGISTRO GERAL') || t.includes('CARTEIRA DE IDENTIDADE') || t.includes('SEGURANCA PUBLICA');
  const rgDataMarkers = t.includes('FILIACAO') || t.includes('NATURALIDADE') || t.includes('EXPEDICAO');
  if (rgHeader || rgDataMarkers) {
    return rgDataMarkers ? 'rg_back' : 'rg_front';
  }

  const cpfMarkers =
    t.includes('CADASTRO DE PESSOAS FISICAS') ||
    t.includes('CADASTRO DE PESSOA FISICA') ||
    (t.includes('CPF') && CPF_NUMBER.test(t));
  if (cpfMarkers) return 'cpf';

  return 'unknown';
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd apps/bot && bun test doc-classifier`
Expected: PASS (9 testes)

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/services/doc-classifier.ts apps/bot/src/__tests__/doc-classifier.test.ts
git commit -m "bot: classificador deterministico de documentos por OCR"
```

---

### Task 3: Checklist de análise (CONTRATO)

**Files:**
- Create: `apps/bot/src/flows/lead/checklist.ts`
- Test: `apps/bot/src/__tests__/checklist.test.ts`

**Interfaces:**
- Consumes: `LeadDocumentType`, `DOC_TYPE_LABEL` (Task 2); `prisma` de `@/db/client` (Task 1: `declaredIncome`, `expectedResidents`, `leadResident`).
- Produces (congelado — Fase B importa):

```ts
export interface ChecklistInput {
  name: string | null;
  declaredIncome: number | null;
  expectedResidents: number | null;
  residentsCollected: number;
  documents: LeadDocumentType[];
}
export interface ChecklistStatus {
  name: boolean;
  income: boolean;
  identity: { complete: boolean; have: LeadDocumentType[]; missing: string[] };
  residents: { complete: boolean; expected: number | null; collected: number };
  complete: boolean;
}
export function buildChecklist(input: ChecklistInput): ChecklistStatus;
export function renderChecklistText(status: ChecklistStatus): string;   // para o lead
export function renderChecklistContext(status: ChecklistStatus): string; // para prompt do LLM
export async function getChecklistForLead(leadId: string): Promise<ChecklistStatus>;
```

- [ ] **Step 1: Escrever os testes que falham**

```ts
// apps/bot/src/__tests__/checklist.test.ts
import { describe, expect, it } from 'bun:test';
import { buildChecklist, renderChecklistText } from '@/flows/lead/checklist';

const base = {
  name: 'Frederico',
  declaredIncome: 12000,
  expectedResidents: 2,
  residentsCollected: 2,
  documents: [] as import('@/services/doc-classifier').LeadDocumentType[],
};

describe('buildChecklist — identidade', () => {
  it('cnh_full sozinha completa identidade', () => {
    const s = buildChecklist({ ...base, documents: ['cnh_full'] });
    expect(s.identity.complete).toBe(true);
    expect(s.complete).toBe(true);
  });

  it('cnh_front + cnh_back completa identidade', () => {
    const s = buildChecklist({ ...base, documents: ['cnh_front', 'cnh_back'] });
    expect(s.identity.complete).toBe(true);
  });

  it('rg_front + rg_back + cpf completa identidade', () => {
    const s = buildChecklist({ ...base, documents: ['rg_front', 'rg_back', 'cpf'] });
    expect(s.identity.complete).toBe(true);
  });

  it('só cnh_front → falta o verso', () => {
    const s = buildChecklist({ ...base, documents: ['cnh_front'] });
    expect(s.identity.complete).toBe(false);
    expect(s.identity.missing).toEqual(['verso da CNH']);
  });

  it('rg_back + cpf → falta frente do RG', () => {
    const s = buildChecklist({ ...base, documents: ['rg_back', 'cpf'] });
    expect(s.identity.missing).toEqual(['frente do RG']);
  });

  it('nenhum doc → pede CNH ou RG+CPF', () => {
    const s = buildChecklist({ ...base, documents: [] });
    expect(s.identity.missing).toEqual(['CNH (frente e verso, ou foto única aberta) ou RG + CPF']);
  });

  it('unknown não conta', () => {
    const s = buildChecklist({ ...base, documents: ['unknown', 'unknown'] });
    expect(s.identity.complete).toBe(false);
  });
});

describe('buildChecklist — renda e moradores', () => {
  it('sem renda declarada → income false e checklist incompleto', () => {
    const s = buildChecklist({ ...base, declaredIncome: null, documents: ['cnh_full'] });
    expect(s.income).toBe(false);
    expect(s.complete).toBe(false);
  });

  it('moradores: expected null → incompleto', () => {
    const s = buildChecklist({ ...base, expectedResidents: null, residentsCollected: 0, documents: ['cnh_full'] });
    expect(s.residents.complete).toBe(false);
  });

  it('moradores: coletados < esperados → incompleto', () => {
    const s = buildChecklist({ ...base, expectedResidents: 3, residentsCollected: 1, documents: ['cnh_full'] });
    expect(s.residents.complete).toBe(false);
    expect(s.complete).toBe(false);
  });
});

describe('renderChecklistText', () => {
  it('mostra pendências com ⬜ e completos com ✅', () => {
    const s = buildChecklist({ ...base, declaredIncome: null, documents: ['cnh_front'] });
    const text = renderChecklistText(s);
    expect(text).toContain('⬜ Renda');
    expect(text).toContain('⬜ Documento de identidade (falta: verso da CNH)');
    expect(text).toContain('✅ Moradores');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/bot && bun test checklist`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
// apps/bot/src/flows/lead/checklist.ts
import { prisma } from '@/db/client';
import type { LeadDocumentType } from '@/services/doc-classifier';

export interface ChecklistInput {
  name: string | null;
  declaredIncome: number | null;
  expectedResidents: number | null;
  residentsCollected: number;
  documents: LeadDocumentType[];
}

export interface ChecklistStatus {
  name: boolean;
  income: boolean;
  identity: { complete: boolean; have: LeadDocumentType[]; missing: string[] };
  residents: { complete: boolean; expected: number | null; collected: number };
  complete: boolean;
}

function identityStatus(documents: LeadDocumentType[]): ChecklistStatus['identity'] {
  const have = documents.filter((d) => d !== 'unknown' && d !== 'income_proof');
  const has = (t: LeadDocumentType) => have.includes(t);

  if (has('cnh_full') || (has('cnh_front') && has('cnh_back'))) {
    return { complete: true, have, missing: [] };
  }
  if (has('rg_front') && has('rg_back') && has('cpf')) {
    return { complete: true, have, missing: [] };
  }

  // Caminho CNH iniciado
  if (has('cnh_front')) return { complete: false, have, missing: ['verso da CNH'] };
  if (has('cnh_back')) return { complete: false, have, missing: ['frente da CNH'] };

  // Caminho RG+CPF iniciado
  if (has('rg_front') || has('rg_back') || has('cpf')) {
    const missing: string[] = [];
    if (!has('rg_front')) missing.push('frente do RG');
    if (!has('rg_back')) missing.push('verso do RG');
    if (!has('cpf')) missing.push('CPF');
    return { complete: false, have, missing };
  }

  return {
    complete: false,
    have,
    missing: ['CNH (frente e verso, ou foto única aberta) ou RG + CPF'],
  };
}

export function buildChecklist(input: ChecklistInput): ChecklistStatus {
  const identity = identityStatus(input.documents);
  const income = input.declaredIncome != null && input.declaredIncome > 0;
  const residents = {
    expected: input.expectedResidents,
    collected: input.residentsCollected,
    complete:
      input.expectedResidents != null &&
      input.expectedResidents > 0 &&
      input.residentsCollected >= input.expectedResidents,
  };
  const name = !!(input.name ?? '').trim();

  return {
    name,
    income,
    identity,
    residents,
    complete: name && income && identity.complete && residents.complete,
  };
}

export function renderChecklistText(status: ChecklistStatus): string {
  const lines: string[] = [];
  lines.push(status.income ? '✅ Renda' : '⬜ Renda mensal (pode ser só o valor)');
  lines.push(
    status.identity.complete
      ? '✅ Documento de identidade'
      : `⬜ Documento de identidade (falta: ${status.identity.missing.join(', ')})`,
  );
  lines.push(
    status.residents.complete
      ? '✅ Moradores'
      : status.residents.expected == null
        ? '⬜ Moradores (quantas pessoas vão morar?)'
        : `⬜ Moradores (${status.residents.collected} de ${status.residents.expected} informados)`,
  );
  return lines.join('\n');
}

export function renderChecklistContext(status: ChecklistStatus): string {
  return [
    `Checklist da analise (fonte: banco de dados — NUNCA contradiga):`,
    `- Nome: ${status.name ? 'ok' : 'pendente'}`,
    `- Renda declarada: ${status.income ? 'ok' : 'pendente'}`,
    `- Identidade: ${status.identity.complete ? 'completa' : `pendente (falta: ${status.identity.missing.join(', ')})`}`,
    `- Documentos recebidos: ${status.identity.have.length > 0 ? status.identity.have.join(', ') : 'nenhum'}`,
    `- Moradores: ${status.residents.complete ? 'completos' : status.residents.expected == null ? 'quantidade ainda nao informada' : `${status.residents.collected} de ${status.residents.expected}`}`,
    `- Analise pronta para envio: ${status.complete}`,
  ].join('\n');
}

export async function getChecklistForLead(leadId: string): Promise<ChecklistStatus> {
  const [lead, documents, residentsCount] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: leadId },
      select: { name: true, declaredIncome: true, expectedResidents: true },
    }),
    prisma.leadDocument.findMany({ where: { leadId }, select: { type: true } }),
    prisma.leadResident.count({ where: { leadId } }),
  ]);

  return buildChecklist({
    name: lead?.name ?? null,
    declaredIncome: lead?.declaredIncome != null ? Number(lead.declaredIncome) : null,
    expectedResidents: lead?.expectedResidents ?? null,
    residentsCollected: residentsCount,
    documents: documents.map((d) => d.type as LeadDocumentType),
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd apps/bot && bun test checklist`
Expected: PASS

- [ ] **Step 5: Typecheck + commit**

Run: `cd apps/bot && bunx tsc --noEmit`

```bash
git add apps/bot/src/flows/lead/checklist.ts apps/bot/src/__tests__/checklist.test.ts
git commit -m "bot: checklist de analise dirigido pelo banco"
```

> **CHECKPOINT DE COORDENAÇÃO — PR do contrato:** Tasks 2 e 3 formam o contrato da Fase B. Abrir a PR agora:
>
> ```bash
> git push -u origin feat/lead-flow-v2-contract
> gh pr create \
>   --title "feat(bot): contrato do lead flow v2 — classificador de docs + checklist" \
>   --body "$(cat <<'EOF'
> Tasks 2+3 da Fase A (plan: docs/superpowers/plans/2026-07-02-lead-flow-v2-fase-a-doc-pipeline.md).
> Módulos puros, sem mudança de comportamento em runtime. Mergear cedo: é o contrato
> congelado que desbloqueia a Fase B em paralelo (ver README de coordenação).
>
> - `services/doc-classifier.ts` — classificação determinística por OCR (CNH/RG/CPF/renda, cnh_full)
> - `flows/lead/checklist.ts` — checklist de análise dirigido pelo banco
>
> 🤖 Generated with [Claude Code](https://claude.com/claude-code)
> EOF
> )"
> ```
>
> Depois da PR mergeada pelo Fred: criar `feat/lead-flow-v2-fase-a` de `main` e seguir para a Task 1 (migration) e Tasks 4–10.

---

### Task 4: OCR por conteúdo (base64) — sem dependência de URL pública

**Files:**
- Modify: `apps/bot/src/services/ocr.ts`
- Test: `apps/bot/src/__tests__/ocr-request.test.ts`

**Interfaces:**
- Produces: `extractTextFromBase64(base64: string): Promise<string>` (mesmo contrato de retorno de `extractTextFromImage`: string vazia em falha). `extractTextFromImage(url)` é mantida para compatibilidade.

- [ ] **Step 1: Refatorar `ocr.ts` extraindo o corpo comum**

Substituir `extractTextFromImage` por:

```ts
type VisionImage = { source: { imageUri: string } } | { content: string };

async function annotate(image: VisionImage): Promise<string> {
  const auth = getAuth();
  if (!auth) return '';

  try {
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const token = tokenResponse.token;
    if (!token) return '';

    const response = await fetch('https://vision.googleapis.com/v1/images:annotate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [{ image, features: [{ type: 'TEXT_DETECTION', maxResults: 1 }] }],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger.warn({ status: response.status, body }, '[ocr] Vision API error');
      return '';
    }

    const result = (await response.json()) as {
      responses?: Array<{ fullTextAnnotation?: { text?: string } }>;
    };

    return result.responses?.[0]?.fullTextAnnotation?.text ?? '';
  } catch (err) {
    logger.warn({ err }, '[ocr] annotate error');
    return '';
  }
}

export async function extractTextFromImage(imageUrl: string): Promise<string> {
  return annotate({ source: { imageUri: imageUrl } });
}

export async function extractTextFromBase64(base64: string): Promise<string> {
  return annotate({ content: base64 });
}
```

- [ ] **Step 2: Teste do formato de request (mock de fetch)**

```ts
// apps/bot/src/__tests__/ocr-request.test.ts
import { afterEach, describe, expect, it, mock } from 'bun:test';

mock.module('@/config', () => ({
  config: { GOOGLE_CREDENTIALS_JSON: JSON.stringify({ client_email: 'x', private_key: 'y' }) },
}));
mock.module('google-auth-library', () => ({
  GoogleAuth: class {
    async getClient() {
      return { getAccessToken: async () => ({ token: 'fake-token' }) };
    }
  },
}));

import { extractTextFromBase64 } from '@/services/ocr';

describe('extractTextFromBase64', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('envia image.content (não imageUri) e retorna o texto', async () => {
    let capturedBody: string | null = null;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response(
        JSON.stringify({ responses: [{ fullTextAnnotation: { text: 'CNH TEXTO' } }] }),
        { status: 200 },
      );
    }) as typeof fetch;

    const text = await extractTextFromBase64('QUJD');
    expect(text).toBe('CNH TEXTO');
    const parsed = JSON.parse(capturedBody!);
    expect(parsed.requests[0].image.content).toBe('QUJD');
    expect(parsed.requests[0].image.source).toBeUndefined();
  });
});
```

- [ ] **Step 3: Rodar testes + typecheck**

Run: `cd apps/bot && bun test ocr-request && bunx tsc --noEmit`
Expected: PASS / sem erros

- [ ] **Step 4: Commit**

```bash
git add apps/bot/src/services/ocr.ts apps/bot/src/__tests__/ocr-request.test.ts
git commit -m "bot: OCR por conteudo base64 alem de URL"
```

> **Pendência registrada (decisão do Fred, fora de escopo):** bucket `leads` está público (Fase 0). Com OCR por conteúdo, o caminho fica livre para tornar o bucket privado + signed URLs no painel admin.

---

### Task 5: Pipeline de intake de documentos (substitui persist cego + receipt da Fase 0)

**Files:**
- Create: `apps/bot/src/flows/lead/doc-intake.ts`
- Modify: `apps/bot/src/flows/lead/index.ts` (remove `persistLeadDocuments`, `isDocMedia`, receipt; chama o pipeline)
- Delete: `apps/bot/src/flows/lead/receipt.ts` e `apps/bot/src/__tests__/receipt.test.ts` (substituídos)
- Test: `apps/bot/src/__tests__/doc-intake-reply.test.ts`

**Interfaces:**
- Consumes: `classifyDocument`, `DOC_TYPE_LABEL` (Task 2); `getChecklistForLead`, `ChecklistStatus`, `renderChecklistText` (Task 3); `extractTextFromBase64`/`extractTextFromImage` (Task 4); `MediaItem` de `@/buffer`.
- Produces:

```ts
export interface IntakeOutcome { processed: number; persisted: LeadDocumentType[]; reply: string | null }
export async function handleDocumentIntake(
  chatId: string, leadId: string, ownerId: string, mediaItems: MediaItem[],
): Promise<IntakeOutcome>;
export function buildIntakeReply(
  persisted: LeadDocumentType[], duplicates: LeadDocumentType[], unknownCount: number, checklist: ChecklistStatus,
): string;
```

- [ ] **Step 1: Teste da resposta (função pura) — escrever e ver falhar**

```ts
// apps/bot/src/__tests__/doc-intake-reply.test.ts
import { describe, expect, it } from 'bun:test';
import { buildChecklist } from '@/flows/lead/checklist';
import { buildIntakeReply } from '@/flows/lead/doc-intake';

const baseInput = {
  name: 'Frederico',
  declaredIncome: 12000,
  expectedResidents: 1,
  residentsCollected: 1,
  documents: [] as import('@/services/doc-classifier').LeadDocumentType[],
};

describe('buildIntakeReply', () => {
  it('confirma o que recebeu e diz o que falta', () => {
    const checklist = buildChecklist({ ...baseInput, documents: ['cnh_front'] });
    const reply = buildIntakeReply(['cnh_front'], [], 0, checklist);
    expect(reply).toContain('✅ Recebi: frente da CNH');
    expect(reply).toContain('verso da CNH');
  });

  it('identidade completa → celebra e mostra checklist', () => {
    const checklist = buildChecklist({ ...baseInput, documents: ['cnh_full'] });
    const reply = buildIntakeReply(['cnh_full'], [], 0, checklist);
    expect(reply).toContain('✅ Recebi: CNH completa (foto única)');
    expect(reply).toContain('Documentos de identidade completos');
  });

  it('duplicata → avisa sem pedir de novo', () => {
    const checklist = buildChecklist({ ...baseInput, documents: ['cnh_front'] });
    const reply = buildIntakeReply([], ['cnh_front'], 0, checklist);
    expect(reply).toContain('já tinha recebido a frente da CNH');
  });

  it('não identificado → pede foto melhor', () => {
    const checklist = buildChecklist({ ...baseInput, documents: [] });
    const reply = buildIntakeReply([], [], 1, checklist);
    expect(reply).toContain('não consegui identificar');
  });
});
```

Run: `cd apps/bot && bun test doc-intake-reply`
Expected: FAIL — módulo não existe.

- [ ] **Step 2: Implementar `doc-intake.ts`**

```ts
// apps/bot/src/flows/lead/doc-intake.ts
import type { MediaItem } from '@/buffer';
import { prisma } from '@/db/client';
import {
  type ChecklistStatus,
  getChecklistForLead,
  renderChecklistText,
} from '@/flows/lead/checklist';
import { logger } from '@/lib/logger';
import {
  classifyDocument,
  DOC_TYPE_LABEL,
  type LeadDocumentType,
} from '@/services/doc-classifier';
import { extractTextFromBase64, extractTextFromImage } from '@/services/ocr';

export interface IntakeOutcome {
  processed: number;
  persisted: LeadDocumentType[];
  reply: string | null;
}

function isIntakeMedia(item: MediaItem): boolean {
  const type = item.type ?? '';
  const mime = item.mime ?? '';
  const isDocLike =
    type === 'image' || type === 'document' || mime.startsWith('image/') || mime === 'application/pdf';
  return isDocLike && (!!item.url || !!item.base64);
}

async function ocrMedia(item: MediaItem): Promise<string> {
  if (item.base64) return extractTextFromBase64(item.base64);
  if (!item.url) return '';
  // Buscar bytes e mandar por conteúdo — independe de URL pública
  try {
    const res = await fetch(item.url);
    if (!res.ok) return extractTextFromImage(item.url);
    const buf = Buffer.from(await res.arrayBuffer());
    return extractTextFromBase64(buf.toString('base64'));
  } catch {
    return extractTextFromImage(item.url);
  }
}

export function buildIntakeReply(
  persisted: LeadDocumentType[],
  duplicates: LeadDocumentType[],
  unknownCount: number,
  checklist: ChecklistStatus,
): string {
  const lines: string[] = [];

  for (const type of persisted.filter((t) => t !== 'unknown')) {
    lines.push(`✅ Recebi: ${DOC_TYPE_LABEL[type]}`);
  }
  for (const type of duplicates) {
    lines.push(`Eu já tinha recebido a ${DOC_TYPE_LABEL[type]} — não precisa enviar de novo 😉`);
  }
  if (unknownCount > 0) {
    lines.push(
      unknownCount === 1
        ? 'Recebi uma imagem, mas não consegui identificar o documento. É a CNH, o RG ou o CPF? Se a foto estiver escura ou cortada, tenta de novo com boa iluminação.'
        : `Recebi ${unknownCount} imagens que não consegui identificar. Pode reenviar com boa iluminação e o documento inteiro na foto?`,
    );
  }

  if (checklist.identity.complete && persisted.some((t) => t !== 'unknown')) {
    lines.push('', '📋 Documentos de identidade completos!');
  }

  if (!checklist.complete) {
    lines.push('', 'Status da análise:', renderChecklistText(checklist));
  }

  return lines.join('\n');
}

export async function handleDocumentIntake(
  chatId: string,
  leadId: string,
  ownerId: string,
  mediaItems: MediaItem[],
): Promise<IntakeOutcome> {
  const docItems = mediaItems.filter(isIntakeMedia);
  if (docItems.length === 0) return { processed: 0, persisted: [], reply: null };

  const existing = await prisma.leadDocument.findMany({
    where: { leadId },
    select: { type: true },
  });
  const existingTypes = new Set(existing.map((d) => d.type));

  const persisted: LeadDocumentType[] = [];
  const duplicates: LeadDocumentType[] = [];
  let unknownCount = 0;

  for (const item of docItems) {
    const ocrText = await ocrMedia(item);
    const type = classifyDocument(ocrText);

    if (type === 'unknown') {
      unknownCount += 1;
      continue; // unknown não persiste nem conta — lead reenviará
    }
    if (existingTypes.has(type)) {
      duplicates.push(type);
      continue;
    }

    await prisma.leadDocument.create({
      data: { leadId, type, url: item.url ?? '', ocrText: ocrText || null, ownerId },
    });
    existingTypes.add(type);
    persisted.push(type);
  }

  const checklist = await getChecklistForLead(leadId);
  const reply = buildIntakeReply(persisted, duplicates, unknownCount, checklist);

  logger.info(
    { chatId, persisted, duplicates, unknownCount },
    '[doc-intake] Documentos processados',
  );

  return { processed: docItems.length, persisted, reply };
}
```

- [ ] **Step 3: Rodar o teste puro**

Run: `cd apps/bot && bun test doc-intake-reply`
Expected: PASS

- [ ] **Step 4: Rewire `index.ts` (+ campo de contexto)**

Em `context.ts`, no `interface LeadContext`, adicionar após `dataConfirmationSent?: boolean;` (a Task 6 usa este campo):

```ts
  docsContestations?: number;
```

Remover de `index.ts`: função `persistLeadDocuments`, função `isDocMedia` (mantida cópia local `isIntakeMedia` no pipeline), import de `extractTextFromImage`, import e uso de `buildReceiptMessage`. Deletar `flows/lead/receipt.ts` e `__tests__/receipt.test.ts`.

Adicionar import:

```ts
import { handleDocumentIntake } from '@/flows/lead/doc-intake';
```

Substituir o bloco `// 7. Persist document images` por:

```ts
    // 7. Pipeline determinístico de documentos (zero LLM)
    const intake = await handleDocumentIntake(chatId, lead.id, ownerId, mediaItems);
    if (intake.reply) {
      await sendText(chatId, intake.reply);
    }
    if (intake.persisted.length > 0) {
      context.docsContestations = 0; // novo doc real zera contestação (Task 6)
      if (context.dataConfirmed || context.dataConfirmationSent) {
        context.dataConfirmed = false;
        context.dataConfirmationSent = false;
      }
    }
    // Turno só de documento: a resposta determinística basta — não acionar LLM
    if (!messageText && intake.processed > 0) {
      context.lastUserMessage = '';
      context.lastRoutedAgent = 'deterministic_doc_intake';
      await persistConversation(chatId, context, null, intake.reply, ownerId);
      return;
    }
```

Nota: o bloco existente "Reset data confirmation if new documents..." (que usava `isDocMedia`) é absorvido pelo código acima — remover o antigo.

- [ ] **Step 5: Rodar tudo + typecheck**

Run: `cd apps/bot && bun test && bunx tsc --noEmit`
Expected: PASS / sem erros (testes de `receipt` removidos junto com o módulo)

- [ ] **Step 6: Commit**

```bash
git add -A apps/bot/src
git commit -m "flow: pipeline deterministico de intake de documentos"
```

---

### Task 6: Transparência total + contador de contestação

**Files:**
- Modify: `apps/bot/src/flows/lead/intents.ts` (novo detector)
- Modify: `apps/bot/src/flows/lead/doc-intake.ts` (nova função `buildTransparencyReply`)
- Modify: `apps/bot/src/flows/lead/context.ts` (campo `docsContestations` no `LeadContext`)
- Modify: `apps/bot/src/flows/lead/index.ts` (gate de contestação)
- Test: `apps/bot/src/__tests__/contestation.test.ts`

**Interfaces:**
- Produces: `detectDocContestation(message: string | null): boolean` em `intents.ts`; `buildTransparencyReply(docs: Array<{ type: string; createdAt: Date }>, checklist: ChecklistStatus): string` em `doc-intake.ts`; `LeadContext.docsContestations?: number`.
- Consumes: `escalateToHuman` (Task 7 — se executando fora de ordem, stub temporário é aceitável apenas dentro do worktree; o plan assume ordem).

- [ ] **Step 1: Testes que falham**

```ts
// apps/bot/src/__tests__/contestation.test.ts
import { describe, expect, it } from 'bun:test';
import { buildChecklist } from '@/flows/lead/checklist';
import { buildTransparencyReply } from '@/flows/lead/doc-intake';
import { detectDocContestation } from '@/flows/lead/intents';

describe('detectDocContestation', () => {
  it('detecta variações de "já enviei"', () => {
    expect(detectDocContestation('Eu já enviei')).toBe(true);
    expect(detectDocContestation('ja te mandei a CNH')).toBe(true);
    expect(detectDocContestation('Mandei sim, olha aí')).toBe(true);
  });
  it('não dispara em mensagens normais', () => {
    expect(detectDocContestation('vou enviar amanhã')).toBe(false);
    expect(detectDocContestation(null)).toBe(false);
  });
});

describe('buildTransparencyReply', () => {
  const checklist = buildChecklist({
    name: 'Frederico',
    declaredIncome: 12000,
    expectedResidents: 1,
    residentsCollected: 1,
    documents: ['cnh_front'],
  });

  it('sem docs no banco → diz que não recebeu nada', () => {
    const reply = buildTransparencyReply([], checklist);
    expect(reply).toContain('não recebi nenhum documento');
  });

  it('com docs → lista tipo e horário e o que falta', () => {
    const reply = buildTransparencyReply(
      [{ type: 'cnh_front', createdAt: new Date('2026-07-02T21:01:00-03:00') }],
      checklist,
    );
    expect(reply).toContain('frente da CNH');
    expect(reply).toContain('21:01');
    expect(reply).toContain('verso da CNH');
  });
});
```

Run: `cd apps/bot && bun test contestation`
Expected: FAIL

- [ ] **Step 2: Implementar detector em `intents.ts`**

Adicionar após `DETAILS_TERMS`:

```ts
const CONTESTATION_TERMS = [
  'ja enviei',
  'ja mandei',
  'ja te enviei',
  'ja te mandei',
  'enviei sim',
  'mandei sim',
  'acabei de enviar',
  'acabei de mandar',
];

export function detectDocContestation(message: string | null): boolean {
  const normalized = normalizeIntentText(message ?? '');
  if (!normalized) return false;
  return CONTESTATION_TERMS.some((t) => normalized.includes(t));
}
```

- [ ] **Step 3: Implementar `buildTransparencyReply` em `doc-intake.ts`**

```ts
export function buildTransparencyReply(
  docs: Array<{ type: string; createdAt: Date }>,
  checklist: ChecklistStatus,
): string {
  if (docs.length === 0) {
    return (
      'Verifiquei aqui: não recebi nenhum documento no sistema até agora 😕\n' +
      'Pode ter havido falha no envio. Pode reenviar a foto, por favor?'
    );
  }

  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const lines = docs.map((d) => {
    const label = DOC_TYPE_LABEL[d.type as LeadDocumentType] ?? d.type;
    return `• ${label} — recebido em ${fmt.format(d.createdAt)}`;
  });

  const missing = checklist.identity.complete
    ? ''
    : `\n\nAinda falta: ${checklist.identity.missing.join(', ')}. Se você enviou algo que não está na lista, pode reenviar?`;

  return `Verifiquei aqui. No sistema recebi:\n${lines.join('\n')}${missing}`;
}
```

- [ ] **Step 4: Campo no contexto (`context.ts`)**

No `interface LeadContext`, adicionar após `dataConfirmationSent?: boolean;`:

```ts
  docsContestations?: number;
```

- [ ] **Step 5: Gate em `index.ts`**

Adicionar imports: `detectDocContestation` (junto de `getSimpleGreetingReply`), `buildTransparencyReply` (junto de `handleDocumentIntake`), `getChecklistForLead` de `@/flows/lead/checklist`, `escalateToHuman` de `@/flows/lead/escalation` (Task 7).

Inserir logo APÓS o bloco de intake da Task 5 (e antes da seção `// 8. Resolve property in focus`):

```ts
    // Contestação de documentos — transparência total, determinístico
    if (intake.processed === 0 && detectDocContestation(messageText)) {
      const checklist = await getChecklistForLead(lead.id);
      if (!checklist.identity.complete) {
        const count = (context.docsContestations ?? 0) + 1;
        context.docsContestations = count;

        if (count >= 2) {
          await escalateToHuman(chatId, lead.ownerId, lead.name, 'contestation');
          await persistConversation(chatId, context, messageText, null, ownerId);
          return;
        }

        const docs = await prisma.leadDocument.findMany({
          where: { leadId: lead.id },
          select: { type: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        });
        const reply = buildTransparencyReply(docs, checklist);
        context.lastUserMessage = messageText;
        context.lastRoutedAgent = 'deterministic_transparency';
        await persistConversation(chatId, context, messageText, reply, ownerId);
        await sendText(chatId, reply);
        return;
      }
    }
```

- [ ] **Step 6: Rodar tudo + typecheck + commit**

Run: `cd apps/bot && bun test && bunx tsc --noEmit`
Expected: PASS (Task 7 precisa existir para o import compilar — executar Tasks 6 e 7 na ordem, ou juntas no mesmo review)

```bash
git add apps/bot/src
git commit -m "flow: transparencia total e contador de contestacao de docs"
```

---

### Task 7: Escalação para humano (CONTRATO) + notificação `human_needed`

**Files:**
- Create: `apps/bot/src/flows/lead/escalation.ts`
- Modify: `apps/bot/src/services/notify.ts` (novo event type)
- Modify: `apps/bot/src/flows/lead/index.ts` (agir sobre `wantsHuman`, frustração e loop)
- Test: `apps/bot/src/__tests__/escalation.test.ts`

**Interfaces:**
- Produces (congelado — Fase B importa):

```ts
export type EscalationReason = 'human_request' | 'frustration' | 'loop' | 'contestation';
export async function escalateToHuman(
  chatId: string, ownerId: string, leadName: string | null, reason: EscalationReason,
): Promise<void>;
export function detectFrustration(message: string | null): boolean;
export function isSameReply(a: string | null, b: string | null): boolean;
```

- [ ] **Step 1: Testes puros que falham**

```ts
// apps/bot/src/__tests__/escalation.test.ts
import { describe, expect, it } from 'bun:test';
import { detectFrustration, isSameReply } from '@/flows/lead/escalation';

describe('detectFrustration', () => {
  it('detecta ofensa', () => {
    expect(detectFrustration('Retardado, eu já enviei. Consegue entender?')).toBe(true);
    expect(detectFrustration('que bot lixo')).toBe(true);
  });
  it('não dispara em mensagem neutra', () => {
    expect(detectFrustration('pode me mandar o endereço?')).toBe(false);
    expect(detectFrustration(null)).toBe(false);
  });
});

describe('isSameReply', () => {
  it('mesma resposta com pontuação/caixa diferente → true', () => {
    expect(
      isSameReply('Entendi, Frederico. Precisamos avançar!', 'entendi frederico precisamos avancar'),
    ).toBe(true);
  });
  it('respostas diferentes → false', () => {
    expect(isSameReply('Bom dia!', 'A visita foi confirmada.')).toBe(false);
  });
  it('null nunca é igual', () => {
    expect(isSameReply(null, null)).toBe(false);
  });
});
```

Run: `cd apps/bot && bun test escalation`
Expected: FAIL

- [ ] **Step 2: Implementar `escalation.ts`**

```ts
// apps/bot/src/flows/lead/escalation.ts
import { prisma } from '@/db/client';
import { normalizeIntentText } from '@/flows/lead/intents';
import { logger } from '@/lib/logger';
import { sendText } from '@/services/evolution';
import { notifyOwner } from '@/services/notify';

export type EscalationReason = 'human_request' | 'frustration' | 'loop' | 'contestation';

const REASON_LABEL: Record<EscalationReason, string> = {
  human_request: 'Lead pediu atendimento humano',
  frustration: 'Lead demonstrou frustração com o bot',
  loop: 'Bot detectou repetição da própria resposta',
  contestation: 'Lead insiste que enviou documentos que não constam no sistema',
};

const LEAD_MESSAGE: Record<EscalationReason, string> = {
  human_request:
    'Claro! Vou pedir para um atendente humano assumir a conversa. Você recebe retorno em breve 🙂',
  frustration:
    'Peço desculpas pela experiência. Vou passar seu atendimento para uma pessoa da equipe — retorno em breve.',
  loop: 'Percebi que não estou conseguindo te ajudar direito. Um atendente humano vai assumir a conversa em breve.',
  contestation:
    'Vou pedir para a equipe verificar seus documentos manualmente — pode ter havido falha no recebimento. Retorno em breve!',
};

const FRUSTRATION_TERMS = [
  'retardado',
  'burro',
  'idiota',
  'imbecil',
  'incompetente',
  'inutil',
  'lixo',
  'merda',
  'porra',
  'caralho',
  'nao esta entendendo',
  'nao ta entendendo',
  'voce nao entende',
  'vc nao entende',
];

export function detectFrustration(message: string | null): boolean {
  const normalized = normalizeIntentText(message ?? '');
  if (!normalized) return false;
  return FRUSTRATION_TERMS.some((t) => normalized.includes(t));
}

export function isSameReply(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return normalizeIntentText(a) === normalizeIntentText(b);
}

export async function escalateToHuman(
  chatId: string,
  ownerId: string,
  leadName: string | null,
  reason: EscalationReason,
): Promise<void> {
  logger.warn({ chatId, reason }, '[escalation] Pausando bot e notificando owner');

  await prisma.conversation.upsert({
    where: { chatId },
    update: { botPaused: true },
    create: { chatId, data: {}, ownerId, botPaused: true },
  });

  await sendText(chatId, LEAD_MESSAGE[reason]).catch((err) =>
    logger.error({ err, chatId }, '[escalation] Falha ao avisar lead'),
  );

  notifyOwner(ownerId, 'human_needed', {
    leadName: leadName ?? chatId,
    leadPhone: chatId,
    reason: REASON_LABEL[reason],
  }).catch((err) => logger.error({ err }, '[escalation] notifyOwner falhou'));
}
```

- [ ] **Step 3: Novo event type em `notify.ts`**

No `NotifyPayloadMap`, adicionar:

```ts
  human_needed: { leadName: string; leadPhone: string; reason: string };
```

Em `buildChannelContent`, adicionar case seguindo o padrão dos existentes:

```ts
    case 'human_needed': {
      const p = payload as NotifyPayloadMap['human_needed'];
      return {
        whatsapp:
          `⚠️ Atendimento humano necessário\n` +
          `Lead: ${p.leadName} (${p.leadPhone})\n` +
          `Motivo: ${p.reason}\n` +
          `O bot foi pausado para este contato.`,
        email: null,
      };
    }
```

- [ ] **Step 4: Agir sobre os gatilhos em `index.ts`**

Import: `detectFrustration`, `escalateToHuman`, `isSameReply` de `@/flows/lead/escalation`.

**Gatilho 1 — frustração/pedido de humano** (inserir logo após o bloco de extração LLM, seção `// 5.`, quando `context.wantsHuman` já foi populado):

```ts
    // Escalação: pedido de humano ou frustração → pausa + notificação
    if (context.wantsHuman || detectFrustration(messageText)) {
      const reason = context.wantsHuman ? 'human_request' : 'frustration';
      await escalateToHuman(chatId, lead.ownerId, lead.name, reason);
      await persistConversation(chatId, context, messageText || null, null, ownerId);
      return;
    }
```

**Gatilho 2 — loop** (inserir na seção `// 16. Send text reply`, substituindo o bloco final):

```ts
    // 16. Send text reply — com detecção de loop
    if (replyText) {
      const lastAssistant = [...chatHistory].reverse().find((m) => m.role === 'assistant');
      if (!bypassAgentReply && isSameReply(replyText, lastAssistant?.content ?? null)) {
        await escalateToHuman(chatId, lead.ownerId, lead.name, 'loop');
        return;
      }
      await sendText(chatId, replyText);
    }
```

Nota: o loop check usa `chatHistory` carregado no início do handler; a resposta repetida não é enviada — a mensagem de escalação substitui.

- [ ] **Step 5: Rodar tudo + typecheck + commit**

Run: `cd apps/bot && bun test && bunx tsc --noEmit`
Expected: PASS / sem erros

```bash
git add apps/bot/src
git commit -m "flow: escalacao para humano (pedido, frustracao, loop) com pausa do bot"
```

---

### Task 8: Renda declarada → `Lead.declaredIncome`

**Files:**
- Create: `apps/bot/src/flows/lead/income.ts`
- Modify: `apps/bot/src/flows/lead/index.ts` (persistir no `leadPatch`)
- Test: `apps/bot/src/__tests__/income.test.ts`

**Interfaces:**
- Produces: `parseIncomeValue(raw: string | null | undefined): number | null`.
- Consumes: `context.income` (string extraída pelo LLM — já existe).

- [ ] **Step 1: Testes que falham**

```ts
// apps/bot/src/__tests__/income.test.ts
import { describe, expect, it } from 'bun:test';
import { parseIncomeValue } from '@/flows/lead/income';

describe('parseIncomeValue', () => {
  it('número puro', () => expect(parseIncomeValue('12000')).toBe(12000));
  it('formato brasileiro', () => expect(parseIncomeValue('R$ 1.234,56')).toBe(1234.56));
  it('milhar com ponto', () => expect(parseIncomeValue('12.000')).toBe(12000));
  it('"3 mil"', () => expect(parseIncomeValue('3 mil')).toBe(3000));
  it('"2,5 mil"', () => expect(parseIncomeValue('2,5 mil')).toBe(2500));
  it('lixo → null', () => expect(parseIncomeValue('não sei')).toBeNull());
  it('null → null', () => expect(parseIncomeValue(null)).toBeNull());
  it('zero/negativo → null', () => expect(parseIncomeValue('0')).toBeNull());
});
```

Run: `cd apps/bot && bun test income`
Expected: FAIL

- [ ] **Step 2: Implementar**

```ts
// apps/bot/src/flows/lead/income.ts
export function parseIncomeValue(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = raw.toLowerCase().replace(/r\$/g, '').trim();

  const milMatch = /^(\d+(?:[.,]\d+)?)\s*mil$/.exec(t);
  if (milMatch) {
    const base = parseFloat(milMatch[1].replace(',', '.'));
    return Number.isFinite(base) && base > 0 ? Math.round(base * 1000) : null;
  }

  const cleaned = t.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}
```

- [ ] **Step 3: Persistir em `index.ts`**

Import: `parseIncomeValue` de `@/flows/lead/income`.

Inserir junto aos outros patches de lead (após o bloco `// Persistir nome extraído pelo LLM`):

```ts
    // Persistir renda declarada (valor numérico) — comprovante não bloqueia
    const incomeValue = parseIncomeValue(context.income);
    if (incomeValue != null && Number(lead.declaredIncome ?? 0) !== incomeValue) {
      leadPatch.declaredIncome = incomeValue;
    }
```

- [ ] **Step 4: Rodar tudo + typecheck + commit**

Run: `cd apps/bot && bun test && bunx tsc --noEmit`

```bash
git add apps/bot/src
git commit -m "flow: persistir renda declarada no lead"
```

---

### Task 9: Moradores por quantidade

**Files:**
- Modify: `apps/bot/src/agents/lead.ts` (extractor schema + prompt do collection)
- Modify: `apps/bot/src/flows/lead/context.ts` (`expectedResidents` no `LeadContext`)
- Modify: `apps/bot/src/flows/lead/index.ts` (persistir `expectedResidents` e `LeadResident`)
- Test: `apps/bot/src/__tests__/lead-extraction-schema.test.ts` (estender o existente)

**Interfaces:**
- Consumes: `prisma.leadResident` (Task 1).
- Produces: `Lead.expectedResidents` e linhas em `LeadResident` — consumidos por `getChecklistForLead` (Task 3).

- [ ] **Step 1: Estender o teste de schema existente — ver falhar**

Adicionar ao final de `apps/bot/src/__tests__/lead-extraction-schema.test.ts`:

```ts
import { LeadExtractionSchema } from '@/agents/lead';

describe('expected_residents', () => {
  it('aceita quantidade de moradores', () => {
    const parsed = LeadExtractionSchema.parse({ expected_residents: 3 });
    expect(parsed.expected_residents).toBe(3);
  });
  it('default null', () => {
    const parsed = LeadExtractionSchema.parse({});
    expect(parsed.expected_residents).toBeNull();
  });
});
```

Run: `cd apps/bot && bun test lead-extraction-schema`
Expected: FAIL — campo não existe.

- [ ] **Step 2: Extractor schema em `agents/lead.ts`**

No `LeadExtractionSchema`, adicionar após `residents_complete`:

```ts
  expected_residents: z
    .number()
    .int()
    .nullable()
    .default(null)
    .describe(
      'Quantidade TOTAL de pessoas que vão morar no imóvel, quando o lead informar. ' +
        'Ex: "vamos morar eu e minha esposa" → 2; "só eu" → 1; "somos 4" → 4. ' +
        'Sem informação → null.',
    ),
```

Em `extractLeadUpdate`, após o bloco de `residents`:

```ts
  if (typeof raw.expected_residents === 'number' && raw.expected_residents > 0) {
    updates.expectedResidents = raw.expected_residents;
  }
```

No `EXTRACTOR_SYSTEM_PROMPT`, adicionar regra:

```
- expected_residents: preencher apenas quando o lead disser quantas pessoas vao morar. "So eu" = 1. "Eu e minha esposa" = 2.
```

No `COLLECTION_AGENT_PROMPT`, substituir o item `5. moradores com nome, sexo e idade` da ordem por:

```
  5. moradores: pergunte PRIMEIRO quantas pessoas vao morar no imovel; depois colete nome, sexo e idade de cada uma ate completar a quantidade informada
```

- [ ] **Step 3: `LeadContext` em `context.ts`**

Adicionar após `residentsComplete?: boolean | null;`:

```ts
  expectedResidents?: number | null;
```

- [ ] **Step 4: Persistência em `index.ts`**

Inserir junto aos patches de lead (após o bloco de renda da Task 8):

```ts
    // Persistir quantidade esperada de moradores
    if (
      context.expectedResidents != null &&
      context.expectedResidents !== lead.expectedResidents
    ) {
      leadPatch.expectedResidents = context.expectedResidents;
    }

    // Sincronizar moradores coletados com a tabela (replace-all)
    if ((context.residents ?? []).length > 0) {
      const residents = context.residents ?? [];
      await prisma.$transaction([
        prisma.leadResident.deleteMany({ where: { leadId: lead.id } }),
        prisma.leadResident.createMany({
          data: residents.map((r) => ({
            leadId: lead.id,
            ownerId,
            name: r.name,
            sex: r.sex || null,
            age: r.age ?? null,
          })),
        }),
      ]);
    }
```

- [ ] **Step 5: Rodar tudo + typecheck + commit**

Run: `cd apps/bot && bun test && bunx tsc --noEmit`

```bash
git add apps/bot/src
git commit -m "flow: moradores por quantidade com persistencia em LeadResident"
```

---

### Task 10: Integração — checklist substitui docsStage no estado e nos prompts

**Files:**
- Modify: `apps/bot/src/flows/lead/context.ts` (snapshot ganha `checklist`; `deriveState` usa checklist; remove `docsStage`/`docsSummary`/contagens do caminho crítico)
- Modify: `apps/bot/src/flows/lead/kyc.ts` (assinatura simplificada)
- Modify: `apps/bot/src/flows/lead/index.ts` (chamadas atualizadas)
- Modify: `apps/bot/src/agents/lead.ts` (`COLLECTION_AGENT_PROMPT` sem escolha documental)
- Test: `apps/bot/src/__tests__/kycTransition.test.ts` (atualizar), `apps/bot/src/__tests__/derive-state.test.ts` (novo)

**Interfaces:**
- Consumes: `getChecklistForLead`, `renderChecklistContext`, `ChecklistStatus` (Task 3).
- Produces: `LeadSnapshot.checklist: ChecklistStatus`; `deriveState` exportada para teste; `shouldTransitionToKyc(checklistComplete: boolean, leadStage: string, dataConfirmed: boolean): boolean`.

- [ ] **Step 1: Novo teste de `deriveState` — escrever e ver falhar**

```ts
// apps/bot/src/__tests__/derive-state.test.ts
import { describe, expect, it } from 'bun:test';
import { buildChecklist } from '@/flows/lead/checklist';
import { deriveState } from '@/flows/lead/context';

const completeChecklist = buildChecklist({
  name: 'Frederico',
  declaredIncome: 12000,
  expectedResidents: 1,
  residentsCollected: 1,
  documents: ['cnh_full'],
});

const emptyChecklist = buildChecklist({
  name: null,
  declaredIncome: null,
  expectedResidents: null,
  residentsCollected: 0,
  documents: [],
});

const partialChecklist = buildChecklist({
  name: 'Frederico',
  declaredIncome: 12000,
  expectedResidents: null,
  residentsCollected: 0,
  documents: ['cnh_front'],
});

const property = { id: 'p1' } as never;

describe('deriveState com checklist', () => {
  it('checklist com progresso → collect_application mesmo SEM visita', () => {
    const state = deriveState({
      context: { visitedProperty: null },
      intent: 'unknown',
      propertyInFocus: property,
      checklist: partialChecklist,
    });
    expect(state).toBe('lead.collect_application');
  });

  it('checklist completo sem confirmação → data_confirmation', () => {
    const state = deriveState({
      context: { visitedProperty: null },
      intent: 'unknown',
      propertyInFocus: property,
      checklist: completeChecklist,
    });
    expect(state).toBe('lead.data_confirmation');
  });

  it('sem progresso e sem visita → property_info', () => {
    const state = deriveState({
      context: { visitedProperty: null },
      intent: 'unknown',
      propertyInFocus: property,
      checklist: emptyChecklist,
    });
    expect(state).toBe('lead.property_info');
  });

  it('pedido de visita → scheduling (visita continua opcional mas atendida)', () => {
    const state = deriveState({
      context: { visitedProperty: false, wantsSchedule: true },
      intent: 'visit',
      propertyInFocus: property,
      checklist: emptyChecklist,
    });
    expect(state).toBe('lead.visit_scheduling');
  });
});
```

Run: `cd apps/bot && bun test derive-state`
Expected: FAIL — `deriveState` não é exportada e não aceita `checklist`.

- [ ] **Step 2: Refatorar `context.ts`**

`LeadSnapshot`: adicionar `checklist: ChecklistStatus;` e REMOVER os campos `applicationMissingItems`, `docsPreference`, `docsReceivedCount`, `docsRequiredCount`, `docsMissingCount`, `docsStage`, `docsSummary`, `residentsSummary`, `residentsComplete` (o checklist os substitui). Remover também as funções `buildApplicationMissingItems`, `getDocsReceivedCount`, `buildDocsStage`, `buildDocsSummary`, `buildResidentsSummary` e a constante `DOCS_REQUIRED_COUNT`.

Import no topo:

```ts
import { type ChecklistStatus, getChecklistForLead, renderChecklistContext } from '@/flows/lead/checklist';
```

Nova assinatura de `deriveState` (exportada, recebe só o que usa):

```ts
export interface DeriveStateInput {
  context: LeadContext;
  intent: string;
  propertyInFocus: PropertyData | null;
  checklist: ChecklistStatus;
}

export function deriveState(input: DeriveStateInput): string {
  const { context, intent, propertyInFocus, checklist } = input;

  if (context.analysisSubmitted) return 'lead.review_submitted';
  if (intent === 'objection') return 'lead.objection_handling';

  if (!propertyInFocus) {
    if (context.wantsOptions || intent === 'availability' || intent === 'options')
      return 'lead.offer_options';
    return 'lead.start';
  }

  const visited = context.visitedProperty;

  // Pedido explícito de visita sempre vai para scheduling (a menos que já visitou)
  if ((context.wantsSchedule || intent === 'visit') && visited !== true) {
    return context.visitRequested ? 'lead.visit_requested' : 'lead.visit_scheduling';
  }

  if (PROPERTY_INFO_INTENTS.has(intent)) return 'lead.property_info';

  // Visita é opcional — progresso no checklist avança a coleta
  const hasApplicationProgress =
    context.wantsApplication ||
    checklist.income ||
    checklist.identity.have.length > 0 ||
    checklist.residents.collected > 0 ||
    checklist.residents.expected != null;

  if (!hasApplicationProgress) {
    if (visited === true) return 'lead.post_visit_decision';
    return 'lead.property_info';
  }

  if (!checklist.complete) return 'lead.collect_application';
  if (!context.dataConfirmed) return 'lead.data_confirmation';

  return 'lead.review_submitted';
}
```

`buildLeadSnapshot` atualizado:

```ts
export async function buildLeadSnapshot(
  leadId: string,
  context: LeadContext,
): Promise<LeadSnapshot> {
  const propertyInFocus = await resolvePropertyInFocus(context);
  const availableProperties = await listAvailableProperties();
  const checklist = await getChecklistForLead(leadId);
  const intent = context.currentIntent ?? 'unknown';

  const state = deriveState({ context, intent, propertyInFocus, checklist });

  return {
    context,
    intent,
    name: (context.name ?? '').trim() || null,
    propertyInFocus,
    propertyLocked: isPropertyLocked(context),
    availableProperties,
    checklist,
    state,
    stateGuidance: STATE_GUIDANCE[state] ?? STATE_GUIDANCE['lead.start'],
    currentProcessStep: currentProcessStep(state),
  };
}
```

Em `renderLeadContext`, substituir o bloco `applicationStates` inteiro por:

```ts
  const applicationStates = [
    'lead.collect_application',
    'lead.post_visit_decision',
    'lead.review_submitted',
    'lead.data_confirmation',
  ];
  if (applicationStates.includes(snapshot.state)) {
    lines.push(renderChecklistContext(snapshot.checklist));
    lines.push(`Analise submetida: ${snapshot.context.analysisSubmitted === true}.`);
  } else {
    lines.push('Nao peca renda, documentos ou moradores nesta etapa.');
  }
```

- [ ] **Step 3: Simplificar `kyc.ts` e atualizar seu teste**

```ts
export function shouldTransitionToKyc(
  checklistComplete: boolean,
  leadStage: string,
  dataConfirmed: boolean,
): boolean {
  return checklistComplete && dataConfirmed && !KYC_BLOCKER_STAGES.has(leadStage);
}
```

Atualizar `apps/bot/src/__tests__/kycTransition.test.ts` — trocar chamadas de 5 argumentos por 3:

```ts
// exemplos representativos — cobrir os mesmos cenários do teste atual
expect(shouldTransitionToKyc(true, 'collection', true)).toBe(true);
expect(shouldTransitionToKyc(true, 'kyc_pending', true)).toBe(false); // blocker stage
expect(shouldTransitionToKyc(false, 'collection', true)).toBe(false); // checklist incompleto
expect(shouldTransitionToKyc(true, 'collection', false)).toBe(false); // sem confirmação
```

- [ ] **Step 4: Atualizar chamadas em `index.ts`**

- `context.docsReceivedCount = snapshot.docsReceivedCount;` → **remover** (campo saiu do snapshot; `docsReceivedCount` do `LeadContext` pode ficar órfão — remover também do `LeadContext`).
- Chamada do KYC:

```ts
    const kycTransition = shouldTransitionToKyc(
      snapshot.checklist.complete,
      lead.stage,
      context.dataConfirmed ?? false,
    );
```

- No gate de `data_confirmation`, nada muda estruturalmente (o estado agora só é atingido com checklist completo).
- No `COLLECTION_AGENT_PROMPT` (em `agents/lead.ts`), substituir o bloco de ordem/etapa documental por:

```
- Colete apenas o proximo item pendente do "Checklist da analise" presente no contexto.
- Ordem natural: renda mensal -> documentos de identidade -> moradores. Nome geralmente vem dos documentos.
- Documentos aceitos: CNH (frente e verso, ou UMA foto da CNH aberta mostrando frente e verso) OU RG (frente e verso) + CPF.
- NAO pergunte "CNH ou RG?": aceite o que a pessoa enviar; o sistema identifica automaticamente.
- Nunca afirme que um documento foi ou nao foi recebido por conta propria: use apenas o checklist do contexto.
```

- [ ] **Step 5: Rodar tudo + typecheck**

Run: `cd apps/bot && bun test && bunx tsc --noEmit`
Expected: PASS — atenção especial a `derive-state.test.ts`, `kycTransition.test.ts` e aos usos removidos do snapshot.

- [ ] **Step 6: Regressão manual do diálogo que travava (requer stack local)**

Run: `docker compose up -d --build bot && docker compose logs -f bot`
Simular pelo WhatsApp de teste: enviar foto de CNH → esperar "✅ Recebi: ..." com checklist; dizer "já enviei" → esperar resposta de transparência com horário; repetir → esperar pausa + notificação ao owner.

- [ ] **Step 7: Commit**

```bash
git add apps/bot/src
git commit -m "flow: checklist do banco substitui docsStage no estado e nos prompts"
```

- [ ] **Step 8: Abrir a PR da fase**

```bash
git push -u origin feat/lead-flow-v2-fase-a
gh pr create \
  --title "feat(bot): lead flow v2 fase A — pipeline determinístico de docs" \
  --body "$(cat <<'EOF'
## Resumo
Fase A do Lead Flow v2 (plan: docs/superpowers/plans/2026-07-02-lead-flow-v2-fase-a-doc-pipeline.md).
Depende da PR do contrato (feat/lead-flow-v2-contract) já mergeada.

- Migration: `declaredIncome`, `expectedResidents`, tabela `LeadResident`
- OCR por base64 + pipeline determinístico de intake (classifica, persiste tipado, responde checklist)
- Transparência total + contador de contestação ("já enviei")
- Escalação para humano: pedido explícito, frustração, loop — pausa bot + notifica owner
- Renda declarada persistida; moradores por quantidade
- `deriveState` dirigido pelo checklist do banco (visita opcional de fato)

## Como testar
1. `cd apps/bot && bun test && bunx tsc --noEmit`
2. Roteiro de regressão manual da Task 10 Step 6 (diálogo que travava em produção)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 9: Review local** — rodar a skill `coderabbit:code-review` no diff da branch e resolver findings relevantes (fallback: `/code-review`). O app do CodeRabbit também revisará a PR automaticamente.

Reportar a URL da PR ao Fred — merge é dele, após os reviews.

---

## Self-review (executar ao final)

1. `bun test` e `bunx tsc --noEmit` verdes em `apps/bot`.
2. Grep de resíduos: `grep -rn "docsStage\|docsSummary\|docsReceivedCount\|docsMissingCount\|buildReceiptMessage" apps/bot/src` → sem resultados fora de comentários.
3. Conferir spec `docs/lead-flow-v2.md` §2.4–2.8: cada requisito coberto por task (P3→T6, P5→T2/T5, P6→T8, P7→T9, P8→gate mantido, P9→T7).
4. Assinaturas do contrato idênticas às do README de coordenação.
