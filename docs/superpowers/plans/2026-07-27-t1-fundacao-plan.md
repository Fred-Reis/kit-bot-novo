# T1 — Fundação do Fluxo do Inquilino — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tenant flow stub (`flows/tenant/index.ts`) with a working bot path: tenant snapshot with Redis cache, deterministic overrides (greeting/audio/emergency), a single tool-calling agent (reusing the lead v2 pattern) with one tool (`escalar_owner`), and a fixed `botPaused` check in the router that today is silently bypassed for tenants.

**Architecture:** Extract the generic tool-calling loop out of `agents/lead-v2.ts` into a shared `agents/agent-runner.ts` so both lead and tenant agents run through the same battle-tested loop with their own system prompt. Tenant-specific modules mirror the existing lead modules 1:1 (`flows/tenant/{context,intents,escalation}.ts`, `agents/{tenant-tools,tenant-v2}.ts`) so the two flows stay independently readable.

**Tech Stack:** Bun, TypeScript, Prisma, ioredis, `@langchain/core` + `@langchain/openai` (already used by lead v2), Zod, `bun:test` with `mock.module`.

## Global Constraints

- Package manager: `bun` only — never `npm`/`yarn`.
- No Python, anywhere.
- Money/decimal values read from Prisma must be converted with `Number(...)` before JSON-serializing (Prisma `Decimal` is not JSON-safe) — see Task 6.
- Every new Prisma-touching module must be unit-testable via `mock.module('@/db/client', ...)` and `mock.module('@/db/redis', ...)`, matching `apps/bot/src/__tests__/agent-tools.test.ts` and `apps/bot/src/__tests__/buffer-media-race.test.ts`.
- Bun's `mock.module()` is process-global for the whole `bun test` run — it is NOT scoped to the file that calls it. If test file A mocks module X wholesale and test file B imports the real module X to test it, whichever registration Bun resolves first for that specifier wins for every importer in the run, silently breaking the other file. **Never mock a sibling application module (`@/flows/...`, `@/agents/...`) wholesale in a test file if another test file in the suite imports that same module for real** — mock only the leaf dependencies (`@/db/client`, `@/db/redis`, `@/services/*`) instead, and let the real sibling module run. This bit T1 three times (Tasks 7, 9, and 10) before the pattern below was adopted everywhere it applied.
- The project's real test command is `bun test src/__tests__` (see `apps/bot/package.json`'s `test`/`check` scripts) — it does **not** sweep `src/flows/*/__tests__` (a pre-existing gap; `flows/lead/__tests__/*.test.ts` was already outside that scope before T1). A bare `bun test` with no path sweeps everything and can surface mock.module collisions that `bun run test` never sees. Verify with **both** `bun test src/__tests__` and `bun test src/flows` when adding files under `flows/tenant/__tests__` — Task 10 hit exactly this: `router-bot-paused.test.ts` (in `src/__tests__`, wholesale-mocking `@/flows/tenant/index`) only collided with `index.test.ts` (in `src/flows/tenant/__tests__`, real-importing that same module) under a bare sweep, not under either real command.
- `ActivityLogAction` in `packages/types/src/activity-log.ts` is a closed string union — new actions must be added there, not passed as raw strings.
- Design source of truth: `docs/superpowers/specs/2026-07-27-tenant-flow-phase2-design.md` §3 (arquitetura), §6 T1, §7 (regras invioláveis), decision T-D7.
- Tracking source of truth: `PRD-FASE2.md` §T1 — mark each completed step's checkbox there in the same commit.

---

### Task 1: Extract generic tool-agent runner from `agents/lead-v2.ts`

**Files:**
- Create: `apps/bot/src/agents/agent-runner.ts`
- Modify: `apps/bot/src/agents/lead-v2.ts`
- Test: `apps/bot/src/__tests__/lead-v2-runner.test.ts` (existing — must stay green, unmodified)

**Interfaces:**
- Produces: `runToolAgent(systemPrompt: string, question: string, contextStr: string, chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>, tools: StructuredToolInterface[], llm?: BoundLLM): Promise<string>`
- Produces: `export interface BoundLLM { invoke(messages: BaseMessage[]): Promise<AIMessage> }`
- Produces: `export function makeDefaultLLM(tools: StructuredToolInterface[]): BoundLLM`
- Produces: `export const FALLBACK_REPLY: string`
- Produces: `export const MAX_TOOL_ROUNDS: number`

This is a pure refactor — no behavior change. `runLeadAgentV2` keeps its exact current signature and behavior.

- [ ] **Step 1: Run the existing lead-v2 runner test to record the current green baseline**

Run: `cd apps/bot && bun test src/__tests__/lead-v2-runner.test.ts`
Expected: PASS (3 tests) — this is the regression net for this task.

- [ ] **Step 2: Create `agents/agent-runner.ts` with the extracted generic loop**

```typescript
import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { config } from '@/config';
import { logger } from '@/lib/logger';

export const MAX_TOOL_ROUNDS = 3;

export const FALLBACK_REPLY =
  'Desculpe, tive um problema para processar sua mensagem. Pode tentar de novo?';

export interface BoundLLM {
  invoke(messages: BaseMessage[]): Promise<AIMessage>;
}

export function makeDefaultLLM(tools: StructuredToolInterface[]): BoundLLM {
  const llm = new ChatOpenAI({
    model: config.OPENAI_MODEL_NAME,
    temperature: 0,
    maxTokens: 600,
    openAIApiKey: config.OPENAI_API_KEY,
  });
  return llm.bindTools(tools) as unknown as BoundLLM;
}

export async function runToolAgent(
  systemPrompt: string,
  question: string,
  contextStr: string,
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  tools: StructuredToolInterface[],
  llm?: BoundLLM,
): Promise<string> {
  const bound = llm ?? makeDefaultLLM(tools);
  const toolsByName = new Map(tools.map((t) => [t.name, t]));

  const messages: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    ...chatHistory.map((m) =>
      m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content),
    ),
    new HumanMessage(`Contexto do sistema:\n${contextStr}\n\nMensagem do usuario:\n${question}`),
  ];

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const ai = await bound.invoke(messages);

      if (!ai.tool_calls || ai.tool_calls.length === 0) {
        const content = typeof ai.content === 'string' ? ai.content.trim() : '';
        return content || FALLBACK_REPLY;
      }

      if (round === MAX_TOOL_ROUNDS) break;

      messages.push(ai);
      for (const call of ai.tool_calls) {
        const t = toolsByName.get(call.name);
        let result: string;
        try {
          result = t ? String(await t.invoke(call.args)) : `Erro: tool ${call.name} nao existe.`;
        } catch (err) {
          logger.error({ err, tool: call.name }, '[agent-runner] tool falhou');
          result = 'Erro: a tool falhou.';
        }
        messages.push(new ToolMessage({ content: result, tool_call_id: call.id ?? call.name }));
      }
    }
  } catch (err) {
    logger.error({ err }, '[agent-runner] runner falhou');
  }

  return FALLBACK_REPLY;
}
```

- [ ] **Step 3: Rewrite `agents/lead-v2.ts` as a thin wrapper over `runToolAgent`**

Replace the file contents with:

```typescript
import type { AIMessage, BaseMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { type BoundLLM, runToolAgent } from '@/agents/agent-runner';

export const LEAD_AGENT_V2_PROMPT = `Voce e o assistente de locacao de imoveis no WhatsApp.

Fatos e estado:
- TODA informacao factual (imovel, valores, regras, documentos, checklist, visita) vem das tools ou do "Contexto do sistema". NUNCA invente, generalize ou improvise fatos, taxas, regras ou disponibilidade.
- Antes de afirmar qualquer coisa sobre documentos ou pendencias, chame status_checklist.
- Antes de responder pergunta factual sobre imovel, chame info_imovel.
- Se um fato nao constar no contexto nem nas tools, diga que nao consta no sistema.
- Nunca contradiga o resultado de uma tool.

Processo (fluxo oficial: interesse -> visita (opcional) -> envio de documentacao para analise -> contrato -> pagamento -> entrega das chaves):
- A visita e OPCIONAL: nunca insista, nunca bloqueie a coleta de documentos por falta de visita.
- Documentos aceitos: CNH (frente e verso, ou UMA foto da CNH aberta) OU RG (frente e verso) + CPF. NAO pergunte "CNH ou RG?" — o sistema identifica o que chegar automaticamente.
- Renda: registrar com registrar_renda quando o lead informar o valor. Comprovante e opcional.
- Moradores: pergunte primeiro QUANTAS pessoas vao morar; registre com registrar_moradores.
- Nunca antecipe contrato, pagamento ou chaves antes da analise concluida.
- Nao peca renda/documentos se a pessoa esta apenas tirando duvidas sobre o imovel.
- Se a pessoa perguntar quem procurar, quem vai mostrar o imovel ou quem recebe no dia da visita, chame info_imovel e responda com o "Responsavel pela visita" retornado. Se a tool retornar erro, diga que nao foi possivel consultar agora e ofereca tentar de novo. Se a tool responder normalmente mas sem esse fato, diga que nao ha responsavel especifico cadastrado no momento. Nunca invente nome ou telefone.

Conversa:
- Responda primeiro a pergunta atual. Maximo UMA pergunta por mensagem.
- Saudacao recebe saudacao curta, sem triagem.
- Nunca mencione URLs ou links de midia; o sistema envia midia automaticamente.
- Se o lead pedir humano, estiver irritado ou voce nao conseguir resolver: chame escalar_humano e NAO envie mais nada.
- Cancelamento/reagendamento de visita: sempre permitido, sem resistencia (use as tools).
- Tom: cordial, direto, breve.`;

export type { BoundLLM };
export type { AIMessage, BaseMessage };

export async function runLeadAgentV2(
  question: string,
  leadContext: string,
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  tools: StructuredToolInterface[],
  llm?: BoundLLM,
): Promise<string> {
  return runToolAgent(LEAD_AGENT_V2_PROMPT, question, leadContext, chatHistory, tools, llm);
}
```

- [ ] **Step 4: Run the lead-v2 runner test again to confirm the refactor is behavior-preserving**

Run: `cd apps/bot && bun test src/__tests__/lead-v2-runner.test.ts`
Expected: PASS (same 3 tests, unmodified file)

- [ ] **Step 5: Typecheck the bot app**

Run: `cd apps/bot && bunx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/bot/src/agents/agent-runner.ts apps/bot/src/agents/lead-v2.ts
git commit -m "refactor: extract generic tool-agent runner from lead-v2

Enables the tenant agent (T1) to reuse the same tool-calling loop
without duplicating it. No behavior change to the lead flow —
runLeadAgentV2 keeps its exact signature and prompt."
```

---

### Task 2: Add tenant activity log actions to shared types

**Files:**
- Modify: `packages/types/src/activity-log.ts`

**Interfaces:**
- Produces: `ActivityLogAction` gains `'tenant_escalated'` and `'tenant_emergency'`
- Produces: `ActivityLogSubjectType` already includes `'tenant'` (no change needed there)

- [ ] **Step 1: Add the two new actions to the `ActivityLogAction` union**

In `packages/types/src/activity-log.ts`, add to the union (after `'coordinator_bulk_linked'`):

```typescript
  | 'coordinator_bulk_linked'
  | 'tenant_escalated'
  | 'tenant_emergency';
```

- [ ] **Step 2: Typecheck the types package**

Run: `cd packages/types && bunx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/activity-log.ts
git commit -m "feat(types): add tenant_escalated and tenant_emergency activity log actions"
```

---

### Task 3: Deterministic tenant overrides — `flows/tenant/intents.ts`

**Files:**
- Create: `apps/bot/src/flows/tenant/intents.ts`
- Test: `apps/bot/src/flows/tenant/__tests__/intents.test.ts`

**Interfaces:**
- Consumes: `normalizeIntentText`, `getSimpleGreetingReply` from `@/flows/lead/intents` (existing, unmodified)
- Produces: `export function getTenantGreetingReply(message: string | null, tenantName: string | null): string | null`
- Produces: `export function detectEmergency(message: string | null): boolean`
- Produces: `export const EMERGENCY_REPLY: string`
- Produces: `export const AUDIO_FALLBACK_REPLY: string`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/bot/src/flows/tenant/__tests__/intents.test.ts
import { describe, expect, test } from 'bun:test';
import {
  AUDIO_FALLBACK_REPLY,
  detectEmergency,
  EMERGENCY_REPLY,
  getTenantGreetingReply,
} from '@/flows/tenant/intents';

describe('getTenantGreetingReply', () => {
  test('oi + nome → saudação personalizada', () => {
    expect(getTenantGreetingReply('oi', 'Maria')).toBe('Olá, Maria!');
  });

  test('bom dia + nome → saudação personalizada', () => {
    expect(getTenantGreetingReply('bom dia', 'Maria')).toBe('Bom dia, Maria!');
  });

  test('saudação sem nome cadastrado → saudação genérica', () => {
    expect(getTenantGreetingReply('oi', null)).toBe('Olá!');
  });

  test('mensagem não é saudação → null', () => {
    expect(getTenantGreetingReply('o chuveiro queimou', 'Maria')).toBeNull();
  });

  test('mensagem vazia → null', () => {
    expect(getTenantGreetingReply(null, 'Maria')).toBeNull();
  });
});

describe('detectEmergency', () => {
  test('incêndio → true', () => {
    expect(detectEmergency('Socorro, tem um incêndio aqui!')).toBe(true);
  });

  test('cheiro de gás → true', () => {
    expect(detectEmergency('Estou sentindo cheiro de gás no apartamento')).toBe(true);
  });

  test('alagamento → true', () => {
    expect(detectEmergency('Houve um alagamento na cozinha')).toBe(true);
  });

  test('fogo → true', () => {
    expect(detectEmergency('Pegou fogo na tomada')).toBe(true);
  });

  test('mensagem normal → false', () => {
    expect(detectEmergency('Quando vence o aluguel?')).toBe(false);
  });

  test('null → false', () => {
    expect(detectEmergency(null)).toBe(false);
  });
});

describe('constantes de resposta', () => {
  test('EMERGENCY_REPLY orienta bombeiros/SAMU', () => {
    expect(EMERGENCY_REPLY).toContain('193');
  });

  test('AUDIO_FALLBACK_REPLY pede texto', () => {
    expect(AUDIO_FALLBACK_REPLY.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/bot && bun test src/flows/tenant/__tests__/intents.test.ts`
Expected: FAIL with "Cannot find module '@/flows/tenant/intents'"

- [ ] **Step 3: Implement `flows/tenant/intents.ts`**

```typescript
import { getSimpleGreetingReply, normalizeIntentText } from '@/flows/lead/intents';

const EMERGENCY_TERMS = ['incendio', 'fogo', 'cheiro de gas', 'alagamento'];

export const EMERGENCY_REPLY =
  '🚨 Emergência registrada. Se houver risco à vida, ligue AGORA para o Corpo de Bombeiros (193) ' +
  'ou SAMU (192). Já avisei o proprietário imediatamente.';

export const AUDIO_FALLBACK_REPLY =
  'Ainda não consigo entender mensagens de áudio. Pode escrever, por favor?';

export function getTenantGreetingReply(
  message: string | null,
  tenantName: string | null,
): string | null {
  const base = getSimpleGreetingReply(message);
  if (!base) return null;

  const name = tenantName?.trim();
  if (!name) return base;

  // "Olá!" -> "Olá, Maria!" / "Bom dia!" -> "Bom dia, Maria!"
  return `${base.slice(0, -1)}, ${name}!`;
}

export function detectEmergency(message: string | null): boolean {
  const normalized = normalizeIntentText(message ?? '');
  if (!normalized) return false;
  return EMERGENCY_TERMS.some((t) => normalized.includes(t));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/bot && bun test src/flows/tenant/__tests__/intents.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/flows/tenant/intents.ts apps/bot/src/flows/tenant/__tests__/intents.test.ts
git commit -m "feat(tenant): deterministic greeting, emergency and audio-fallback overrides"
```

---

### Task 4: Notify owner — tenant escalation and emergency payloads

**Files:**
- Modify: `apps/bot/src/services/notify.ts`
- Test: `apps/bot/src/__tests__/notify-tenant.test.ts`

**Interfaces:**
- Consumes: existing `notifyOwner<T extends NotifyOwnerEventType>(ownerId, eventType, payload)` — unchanged signature, extended `NotifyPayloadMap`
- Produces: `export function buildTenantEscalationMessage(payload: { tenantName: string; tenantPhone: string; reason: string }): string`
- Produces: `export function buildTenantEmergencyMessage(payload: { tenantName: string; tenantPhone: string; propertyName: string }): string`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/bot/src/__tests__/notify-tenant.test.ts
import { describe, expect, test } from 'bun:test';
import { buildTenantEmergencyMessage, buildTenantEscalationMessage } from '@/services/notify';

describe('buildTenantEscalationMessage', () => {
  test('inclui nome, telefone e motivo', () => {
    const msg = buildTenantEscalationMessage({
      tenantName: 'Maria Silva',
      tenantPhone: '11988887777',
      reason: 'Pedido fora do escopo atual (financeiro)',
    });
    expect(msg).toContain('Maria Silva');
    expect(msg).toContain('11988887777');
    expect(msg).toContain('financeiro');
  });
});

describe('buildTenantEmergencyMessage', () => {
  test('inclui nome, telefone e imóvel, e é marcado como urgente', () => {
    const msg = buildTenantEmergencyMessage({
      tenantName: 'João Souza',
      tenantPhone: '11977776666',
      propertyName: 'Kitnet no Retiro',
    });
    expect(msg).toContain('João Souza');
    expect(msg).toContain('11977776666');
    expect(msg).toContain('Kitnet no Retiro');
    expect(msg.toUpperCase()).toContain('EMERGÊNCIA');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/bot && bun test src/__tests__/notify-tenant.test.ts`
Expected: FAIL with "buildTenantEscalationMessage is not a function" (or "is not exported")

- [ ] **Step 3: Extend `services/notify.ts`**

Add to the `NotifyPayloadMap` type (after `media_receive_failure`):

```typescript
  tenant_escalation: { tenantName: string; tenantPhone: string; reason: string };
  tenant_emergency: { tenantName: string; tenantPhone: string; propertyName: string };
```

Add these two exported builder functions (near `buildVisitScheduledMessage`, before `notifyCoordinators`):

```typescript
export function buildTenantEscalationMessage(payload: {
  tenantName: string;
  tenantPhone: string;
  reason: string;
}): string {
  return (
    `⚠️ Inquilino precisa de atenção\n` +
    `Inquilino: ${payload.tenantName} (${payload.tenantPhone})\n` +
    `Motivo: ${payload.reason}\n` +
    `O bot foi pausado para este contato.`
  );
}

export function buildTenantEmergencyMessage(payload: {
  tenantName: string;
  tenantPhone: string;
  propertyName: string;
}): string {
  return (
    `🚨 EMERGÊNCIA reportada por inquilino\n` +
    `Inquilino: ${payload.tenantName} (${payload.tenantPhone})\n` +
    `Imóvel: ${payload.propertyName}\n` +
    `Ligue para o inquilino agora, se possível.`
  );
}
```

Add the two new `case` branches inside `buildChannelContent`'s `switch` (before the closing brace, after `media_receive_failure`):

```typescript
    case 'tenant_escalation': {
      const p = payload as NotifyPayloadMap['tenant_escalation'];
      return { whatsapp: buildTenantEscalationMessage(p), email: null };
    }
    case 'tenant_emergency': {
      const p = payload as NotifyPayloadMap['tenant_emergency'];
      return { whatsapp: buildTenantEmergencyMessage(p), email: null };
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/bot && bun test src/__tests__/notify-tenant.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full notify-related suite to check for regressions**

Run: `cd apps/bot && bun test src/__tests__/notify-coordinators.test.ts src/__tests__/notify-tenant.test.ts`
Expected: PASS (3 tests total)

- [ ] **Step 6: Typecheck**

Run: `cd apps/bot && bunx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add apps/bot/src/services/notify.ts apps/bot/src/__tests__/notify-tenant.test.ts
git commit -m "feat(notify): add tenant_escalation and tenant_emergency owner notifications"
```

---

### Task 5: Tenant escalation — `flows/tenant/escalation.ts`

**Files:**
- Create: `apps/bot/src/flows/tenant/escalation.ts`
- Test: `apps/bot/src/flows/tenant/__tests__/escalation.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/db/client`, `sendText` from `@/services/evolution`, `notifyOwner`, `buildTenantEscalationMessage` from `@/services/notify`, `logActivity` from `@/services/activity`
- Produces: `export type TenantEscalationReason = 'human_request' | 'frustration' | 'out_of_scope'`
- Produces: `export async function escalateTenantToOwner(chatId: string, ownerId: string, tenantId: string, tenantName: string | null, reason: TenantEscalationReason): Promise<void>`

Reuses `detectFrustration` from `@/flows/lead/escalation` directly in `flows/tenant/index.ts` (Task 8) — no duplicate word list needed here.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/bot/src/flows/tenant/__tests__/escalation.test.ts
import { beforeEach, describe, expect, it, mock } from 'bun:test';

const conversationUpserts: Array<Record<string, unknown>> = [];
const sentTexts: Array<{ chatId: string; text: string }> = [];
const activityLogs: Array<Record<string, unknown>> = [];
const notifyCalls: Array<{ ownerId: string; eventType: string; payload: unknown }> = [];

mock.module('@/db/client', () => ({
  prisma: {
    conversation: {
      upsert: async (args: { where: unknown; update: Record<string, unknown>; create: Record<string, unknown> }) => {
        conversationUpserts.push(args.update);
        return {};
      },
    },
  },
}));

mock.module('@/services/evolution', () => ({
  sendText: async (chatId: string, text: string) => {
    sentTexts.push({ chatId, text });
  },
}));

mock.module('@/services/notify', () => ({
  notifyOwner: async (ownerId: string, eventType: string, payload: unknown) => {
    notifyCalls.push({ ownerId, eventType, payload });
  },
  buildTenantEscalationMessage: (p: { tenantName: string; tenantPhone: string; reason: string }) =>
    `mock-message:${p.tenantName}:${p.reason}`,
}));

mock.module('@/services/activity', () => ({
  logActivity: async (params: Record<string, unknown>) => {
    activityLogs.push(params);
  },
}));

import { escalateTenantToOwner } from '@/flows/tenant/escalation';

describe('escalateTenantToOwner', () => {
  beforeEach(() => {
    conversationUpserts.length = 0;
    sentTexts.length = 0;
    activityLogs.length = 0;
    notifyCalls.length = 0;
  });

  it('pausa a conversa, avisa o inquilino, notifica o owner e loga a atividade', async () => {
    await escalateTenantToOwner('5511999999999@s.whatsapp.net', 'owner-1', 'tenant-1', 'Maria', 'out_of_scope');

    expect(conversationUpserts[0]).toEqual({ botPaused: true });
    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0]?.chatId).toBe('5511999999999@s.whatsapp.net');

    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0]?.eventType).toBe('tenant_escalation');

    expect(activityLogs).toHaveLength(1);
    expect(activityLogs[0]?.action).toBe('tenant_escalated');
    expect(activityLogs[0]?.subjectId).toBe('tenant-1');
  });

  it('mensagem ao inquilino sem nome cadastrado usa o telefone', async () => {
    await escalateTenantToOwner('5511999999999@s.whatsapp.net', 'owner-1', 'tenant-1', null, 'human_request');
    expect(notifyCalls[0]?.payload).toMatchObject({ tenantName: '5511999999999@s.whatsapp.net' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/bot && bun test src/flows/tenant/__tests__/escalation.test.ts`
Expected: FAIL with "Cannot find module '@/flows/tenant/escalation'"

- [ ] **Step 3: Implement `flows/tenant/escalation.ts`**

```typescript
import { prisma } from '@/db/client';
import { logActivity } from '@/services/activity';
import { sendText } from '@/services/evolution';
import { buildTenantEscalationMessage, notifyOwner } from '@/services/notify';

export type TenantEscalationReason = 'human_request' | 'frustration' | 'out_of_scope';

const REASON_LABEL: Record<TenantEscalationReason, string> = {
  human_request: 'Inquilino pediu atendimento humano',
  frustration: 'Inquilino demonstrou frustração com o bot',
  out_of_scope: 'Pedido fora do que o bot já resolve sozinho hoje',
};

const TENANT_MESSAGE: Record<TenantEscalationReason, string> = {
  human_request:
    'Claro! Vou pedir para o proprietário assumir a conversa. Você recebe retorno em breve 🙂',
  frustration:
    'Peço desculpas pela experiência. Vou passar seu atendimento para o proprietário — retorno em breve.',
  out_of_scope:
    'Vou encaminhar isso direto para o proprietário, que consegue te ajudar melhor com esse assunto. Retorno em breve!',
};

export async function escalateTenantToOwner(
  chatId: string,
  ownerId: string,
  tenantId: string,
  tenantName: string | null,
  reason: TenantEscalationReason,
): Promise<void> {
  await prisma.conversation.upsert({
    where: { chatId },
    update: { botPaused: true },
    create: { chatId, data: {}, ownerId, botPaused: true },
  });

  const displayName = tenantName ?? chatId;

  await sendText(chatId, TENANT_MESSAGE[reason]);

  await notifyOwner(ownerId, 'tenant_escalation', {
    tenantName: displayName,
    tenantPhone: chatId,
    reason: REASON_LABEL[reason],
  });

  await logActivity({
    ownerId,
    actorType: 'bot',
    actorLabel: 'Bot',
    action: 'tenant_escalated',
    subjectType: 'tenant',
    subjectId: tenantId,
    subject: displayName,
    metadata: { reason },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/bot && bun test src/flows/tenant/__tests__/escalation.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Typecheck**

Run: `cd apps/bot && bunx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/bot/src/flows/tenant/escalation.ts apps/bot/src/flows/tenant/__tests__/escalation.test.ts
git commit -m "feat(tenant): escalateTenantToOwner — pause, notify, log activity"
```

---

### Task 6: Tenant snapshot with Redis cache — `flows/tenant/context.ts`

**Files:**
- Create: `apps/bot/src/flows/tenant/context.ts`
- Test: `apps/bot/src/flows/tenant/__tests__/context.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/db/client`, `redis` from `@/db/redis`
- Produces:
  ```typescript
  export interface TenantSnapshot {
    tenantId: string;
    name: string | null;
    property: { id: string; externalId: string; name: string; address: string; rent: number };
    owner: { id: string; name: string; phone: string };
    contractStart: string; // ISO date
    contractEnd: string | null; // ISO date
    recentPayments: Array<{ month: string; amount: number; status: string }>;
  }
  ```
- Produces: `export async function buildTenantSnapshot(phone: string): Promise<TenantSnapshot | null>`
- Produces: `export async function invalidateTenantSnapshotCache(phone: string): Promise<void>`
- Produces: `export function renderTenantContext(snapshot: TenantSnapshot): string`

Cache key: `` `tenant:${phone}` ``, TTL 1800s (30 min), per design §3.1.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/bot/src/flows/tenant/__tests__/context.test.ts
import { beforeEach, describe, expect, it, mock } from 'bun:test';

const redisStore = new Map<string, string>();
let findUniqueCallCount = 0;

// Prisma's Decimal coerces correctly through plain Number(value) (see
// services/catalog.ts's `Number(p.rent)` pattern) — the mock uses plain
// numbers here since proving Decimal's own coercion isn't this test's job.
const fakeTenantRow = {
  id: 'tenant-1',
  name: 'Maria Silva',
  contractStart: new Date('2026-01-01T00:00:00Z'),
  contractEnd: null,
  property: {
    id: 'prop-1',
    externalId: 'IM-0001',
    name: 'Kitnet no Retiro',
    address: 'Rua Laranjeiras, 111',
    rent: 900,
  },
  owner: { id: 'owner-1', name: 'Fred', phone: '5511988887777' },
  payments: [
    { month: '2026-07', amount: 900, status: 'paid' },
    { month: '2026-06', amount: 900, status: 'paid' },
  ],
};

mock.module('@/db/client', () => ({
  prisma: {
    tenant: {
      findUnique: async () => {
        findUniqueCallCount++;
        return fakeTenantRow;
      },
    },
  },
}));

mock.module('@/db/redis', () => ({
  redis: {
    get: async (key: string) => redisStore.get(key) ?? null,
    set: async (key: string, value: string) => {
      redisStore.set(key, value);
      return 'OK';
    },
    del: async (key: string) => {
      redisStore.delete(key);
      return 1;
    },
  },
}));

import { buildTenantSnapshot, invalidateTenantSnapshotCache, renderTenantContext } from '@/flows/tenant/context';

describe('buildTenantSnapshot', () => {
  beforeEach(() => {
    redisStore.clear();
    findUniqueCallCount = 0;
  });

  it('monta o snapshot a partir do banco na primeira chamada', async () => {
    const snapshot = await buildTenantSnapshot('5511999999999@s.whatsapp.net');
    expect(snapshot?.tenantId).toBe('tenant-1');
    expect(snapshot?.property.rent).toBe(900);
    expect(snapshot?.recentPayments).toHaveLength(2);
    expect(findUniqueCallCount).toBe(1);
  });

  it('segunda chamada usa o cache — não bate no banco de novo', async () => {
    await buildTenantSnapshot('5511999999999@s.whatsapp.net');
    await buildTenantSnapshot('5511999999999@s.whatsapp.net');
    expect(findUniqueCallCount).toBe(1);
  });

  it('invalidateTenantSnapshotCache limpa o cache — próxima chamada bate no banco', async () => {
    await buildTenantSnapshot('5511999999999@s.whatsapp.net');
    await invalidateTenantSnapshotCache('5511999999999@s.whatsapp.net');
    await buildTenantSnapshot('5511999999999@s.whatsapp.net');
    expect(findUniqueCallCount).toBe(2);
  });
});

describe('renderTenantContext', () => {
  it('inclui fatos essenciais do imóvel e contrato', async () => {
    const snapshot = await buildTenantSnapshot('5511999999999@s.whatsapp.net');
    if (!snapshot) throw new Error('snapshot nulo');
    const text = renderTenantContext(snapshot);
    expect(text).toContain('Maria Silva');
    expect(text).toContain('Kitnet no Retiro');
    expect(text).toContain('900');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/bot && bun test src/flows/tenant/__tests__/context.test.ts`
Expected: FAIL with "Cannot find module '@/flows/tenant/context'"

- [ ] **Step 3: Implement `flows/tenant/context.ts`**

```typescript
import { prisma } from '@/db/client';
import { redis } from '@/db/redis';

const CACHE_TTL_SECONDS = 1800; // 30 min — design §3.1

export interface TenantSnapshot {
  tenantId: string;
  name: string | null;
  property: { id: string; externalId: string; name: string; address: string; rent: number };
  owner: { id: string; name: string; phone: string };
  contractStart: string;
  contractEnd: string | null;
  recentPayments: Array<{ month: string; amount: number; status: string }>;
}

function cacheKey(phone: string): string {
  return `tenant:${phone}`;
}

export async function invalidateTenantSnapshotCache(phone: string): Promise<void> {
  await redis.del(cacheKey(phone));
}

export async function buildTenantSnapshot(phone: string): Promise<TenantSnapshot | null> {
  const key = cacheKey(phone);
  const cached = await redis.get(key);
  if (cached) {
    return JSON.parse(cached) as TenantSnapshot;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { phone },
    include: {
      property: { select: { id: true, externalId: true, name: true, address: true, rent: true } },
      owner: { select: { id: true, name: true, phone: true } },
      payments: {
        select: { month: true, amount: true, status: true },
        orderBy: { month: 'desc' },
        take: 3,
      },
    },
  });
  if (!tenant) return null;

  const snapshot: TenantSnapshot = {
    tenantId: tenant.id,
    name: tenant.name,
    property: {
      id: tenant.property.id,
      externalId: tenant.property.externalId,
      name: tenant.property.name,
      address: tenant.property.address,
      rent: Number(tenant.property.rent),
    },
    owner: { id: tenant.owner.id, name: tenant.owner.name, phone: tenant.owner.phone },
    contractStart: tenant.contractStart.toISOString(),
    contractEnd: tenant.contractEnd ? tenant.contractEnd.toISOString() : null,
    recentPayments: tenant.payments.map((p) => ({
      month: p.month,
      amount: Number(p.amount),
      status: p.status,
    })),
  };

  await redis.set(key, JSON.stringify(snapshot), 'EX', CACHE_TTL_SECONDS);
  return snapshot;
}

export function renderTenantContext(snapshot: TenantSnapshot): string {
  const lines = [
    `Inquilino: ${snapshot.name ?? 'não informado'}`,
    `Imóvel: ${snapshot.property.name} (${snapshot.property.externalId}) — ${snapshot.property.address}`,
    `Aluguel: R$ ${snapshot.property.rent.toLocaleString('pt-BR')}`,
    `Proprietário: ${snapshot.owner.name}`,
    `Contrato: início ${snapshot.contractStart.slice(0, 10)}${
      snapshot.contractEnd ? `, fim ${snapshot.contractEnd.slice(0, 10)}` : ', sem data de fim'
    }`,
  ];
  if (snapshot.recentPayments.length > 0) {
    lines.push(
      'Últimos pagamentos: ' +
        snapshot.recentPayments
          .map((p) => `${p.month} R$ ${p.amount.toLocaleString('pt-BR')} (${p.status})`)
          .join('; '),
    );
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/bot && bun test src/flows/tenant/__tests__/context.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Typecheck**

Run: `cd apps/bot && bunx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/bot/src/flows/tenant/context.ts apps/bot/src/flows/tenant/__tests__/context.test.ts
git commit -m "feat(tenant): snapshot builder with 30min Redis cache (tenant:{phone})"
```

---

### Task 7: Tenant tools — `agents/tenant-tools.ts`

**Files:**
- Create: `apps/bot/src/agents/tenant-tools.ts`
- Test: `apps/bot/src/__tests__/tenant-tools.test.ts`

**Interfaces:**
- Consumes: `escalateTenantToOwner` from `@/flows/tenant/escalation`
- Produces:
  ```typescript
  export interface TenantToolDeps {
    chatId: string;
    tenantId: string;
    ownerId: string;
    tenantName: string | null;
  }
  export function buildTenantTools(deps: TenantToolDeps): StructuredToolInterface[]
  ```
  T1 exposes exactly one tool: `escalar_owner`. T2–T5 add `registrar_reclamacao`, `abrir_chamado`, `indicar_profissional`, `status_pagamentos` to this same file/function later.

**A note on the test's mocking strategy:** do NOT mock `@/flows/tenant/escalation` wholesale here. Bun's `mock.module` is process-global for the whole `bun test` run, not scoped to one file — a wholesale mock of a sibling module collides with `escalation.test.ts` (Task 5), which imports that same module for real, and one of the two files' tests will silently start exercising the other's fake. Mock only the leaves `escalateTenantToOwner` itself touches (`@/db/client`, `@/services/evolution`, `@/services/notify`, `@/services/activity`) and let the real `escalateTenantToOwner` run.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/bot/src/__tests__/tenant-tools.test.ts
import { beforeEach, describe, expect, it, mock } from 'bun:test';

const conversationUpserts: Array<Record<string, unknown>> = [];
const sentTexts: Array<{ chatId: string; text: string }> = [];
const notifyCalls: Array<{ ownerId: string; eventType: string }> = [];
const activityLogs: Array<Record<string, unknown>> = [];

mock.module('@/db/client', () => ({
  prisma: {
    conversation: {
      upsert: async (args: { update: Record<string, unknown> }) => {
        conversationUpserts.push(args.update);
        return {};
      },
    },
  },
}));

mock.module('@/services/evolution', () => ({
  sendText: async (chatId: string, text: string) => {
    sentTexts.push({ chatId, text });
  },
}));

mock.module('@/services/notify', () => ({
  notifyOwner: async (ownerId: string, eventType: string) => {
    notifyCalls.push({ ownerId, eventType });
  },
}));

mock.module('@/services/activity', () => ({
  logActivity: async (params: Record<string, unknown>) => {
    activityLogs.push(params);
  },
}));

import { buildTenantTools } from '@/agents/tenant-tools';

const deps = {
  chatId: '5511999999999@s.whatsapp.net',
  tenantId: 'tenant-1',
  ownerId: 'owner-1',
  tenantName: 'Maria',
};

function getTool(name: string) {
  const t = buildTenantTools(deps).find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} não encontrada`);
  return t;
}

describe('escalar_owner', () => {
  beforeEach(() => {
    conversationUpserts.length = 0;
    sentTexts.length = 0;
    notifyCalls.length = 0;
    activityLogs.length = 0;
  });

  it('escala com o motivo informado', async () => {
    const out = (await getTool('escalar_owner').invoke({ motivo: 'pedido de negociação de aluguel' })) as string;

    expect(conversationUpserts[0]).toEqual({ botPaused: true });
    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0]?.chatId).toBe(deps.chatId);
    expect(notifyCalls[0]?.eventType).toBe('tenant_escalation');
    expect(activityLogs[0]).toMatchObject({ action: 'tenant_escalated', subjectId: deps.tenantId });
    expect(out).toContain('pausado');
  });
});

describe('lista completa', () => {
  it('expõe exatamente 1 tool na T1', () => {
    const names = buildTenantTools(deps).map((t) => t.name);
    expect(names).toEqual(['escalar_owner']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/bot && bun test src/__tests__/tenant-tools.test.ts`
Expected: FAIL with "Cannot find module '@/agents/tenant-tools'"

- [ ] **Step 3: Implement `agents/tenant-tools.ts`**

```typescript
import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { escalateTenantToOwner } from '@/flows/tenant/escalation';
import { logger } from '@/lib/logger';

export interface TenantToolDeps {
  chatId: string;
  tenantId: string;
  ownerId: string;
  tenantName: string | null;
}

function fail(msg: string): string {
  return `Erro: ${msg}`;
}

export function buildTenantTools(deps: TenantToolDeps): StructuredToolInterface[] {
  const escalarOwner = tool(
    async ({ motivo }: { motivo: string }) => {
      try {
        await escalateTenantToOwner(deps.chatId, deps.ownerId, deps.tenantId, deps.tenantName, 'out_of_scope');
        logger.info({ motivo }, '[tenant-tools] escalar_owner');
        return 'Assunto encaminhado ao proprietário; o bot foi pausado. NÃO envie mais nada — o sistema já avisou o inquilino.';
      } catch (err) {
        logger.error({ err }, '[tenant-tools] escalar_owner');
        return fail('não consegui encaminhar agora.');
      }
    },
    {
      name: 'escalar_owner',
      description:
        'Pausa o bot e encaminha o assunto ao proprietário. Use quando o inquilino pedir negociação, ' +
        'estiver insatisfeito, pedir atendimento humano, ou trouxer um assunto (manutenção, financeiro) ' +
        'que o bot ainda não resolve sozinho.',
      schema: z.object({ motivo: z.string() }),
    },
  );

  return [escalarOwner];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/bot && bun test src/__tests__/tenant-tools.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Typecheck**

Run: `cd apps/bot && bunx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/bot/src/agents/tenant-tools.ts apps/bot/src/__tests__/tenant-tools.test.ts
git commit -m "feat(tenant): tenant tools — escalar_owner (T-D7)"
```

---

### Task 8: Tenant agent — `agents/tenant-v2.ts`

**Files:**
- Create: `apps/bot/src/agents/tenant-v2.ts`
- Test: `apps/bot/src/__tests__/tenant-v2-runner.test.ts`

**Interfaces:**
- Consumes: `runToolAgent`, `type BoundLLM` from `@/agents/agent-runner`
- Produces: `export const TENANT_AGENT_V2_PROMPT: string`
- Produces: `export async function runTenantAgentV2(question: string, tenantContext: string, chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>, tools: StructuredToolInterface[], llm?: BoundLLM): Promise<string>`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/bot/src/__tests__/tenant-v2-runner.test.ts
import { describe, expect, it } from 'bun:test';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { runTenantAgentV2 } from '@/agents/tenant-v2';

const escalarTool = tool(async () => 'Assunto encaminhado ao proprietário; o bot foi pausado.', {
  name: 'escalar_owner',
  description: 'x',
  schema: z.object({ motivo: z.string() }),
});

function scriptedLLM(responses: AIMessage[]) {
  let i = 0;
  return {
    invoke: async (_messages: BaseMessage[]) => responses[Math.min(i++, responses.length - 1)],
  };
}

describe('runTenantAgentV2', () => {
  it('sem tool calls → devolve o texto direto', async () => {
    const llm = scriptedLLM([new AIMessage('Olá! Em que posso ajudar?')]);
    const out = await runTenantAgentV2('oi', 'ctx', [], [escalarTool], llm);
    expect(out).toBe('Olá! Em que posso ajudar?');
  });

  it('com tool call → executa e usa o resultado na resposta final', async () => {
    const withCall = new AIMessage({
      content: '',
      tool_calls: [{ id: 'c1', name: 'escalar_owner', args: { motivo: 'negociação' } }],
    });
    const final = new AIMessage('Encaminhei ao proprietário, ele responde em breve.');
    const llm = scriptedLLM([withCall, final]);
    const out = await runTenantAgentV2('quero desconto', 'ctx', [], [escalarTool], llm);
    expect(out).toBe('Encaminhei ao proprietário, ele responde em breve.');
  });

  it('estoura o limite de rounds → fallback educado', async () => {
    const withCall = new AIMessage({
      content: '',
      tool_calls: [{ id: 'c1', name: 'escalar_owner', args: { motivo: 'x' } }],
    });
    const llm = scriptedLLM([withCall, withCall, withCall, withCall]);
    const out = await runTenantAgentV2('?', 'ctx', [], [escalarTool], llm);
    expect(out).toContain('tentar de novo');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/bot && bun test src/__tests__/tenant-v2-runner.test.ts`
Expected: FAIL with "Cannot find module '@/agents/tenant-v2'"

- [ ] **Step 3: Implement `agents/tenant-v2.ts`**

```typescript
import type { StructuredToolInterface } from '@langchain/core/tools';
import { type BoundLLM, runToolAgent } from '@/agents/agent-runner';

export const TENANT_AGENT_V2_PROMPT = `Voce e o assistente do inquilino no WhatsApp, falando em nome da administracao do imovel.

Fatos e estado:
- TODA informacao factual (imovel, contrato, pagamentos) vem do "Contexto do sistema" ou das tools. NUNCA invente valores, datas, regras ou status de pagamento.
- Se um fato nao constar no contexto nem nas tools, diga que nao consta no sistema e ofereca encaminhar ao proprietario.
- Nunca contradiga o resultado de uma tool.

Regras invioláveis (nunca decida sozinho):
- Nunca decida questao contratual ambigua — chame escalar_owner.
- Nunca confirme pagamento sem que isso conste no contexto do sistema.
- Nunca prometa prazos de resolucao em nome do proprietario.
- Assuntos que voce ainda nao resolve sozinho (negociacao financeira, manutencao, reclamacao formal): chame escalar_owner e explique que o proprietario vai continuar a conversa.

Conversa:
- Responda primeiro a pergunta atual. Maximo UMA pergunta por mensagem.
- Saudacao recebe saudacao curta, sem triagem.
- Se o inquilino pedir humano, estiver irritado, ou voce nao conseguir resolver: chame escalar_owner e NAO envie mais nada.
- Tom: cordial, direto, breve.`;

export async function runTenantAgentV2(
  question: string,
  tenantContext: string,
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  tools: StructuredToolInterface[],
  llm?: BoundLLM,
): Promise<string> {
  return runToolAgent(TENANT_AGENT_V2_PROMPT, question, tenantContext, chatHistory, tools, llm);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/bot && bun test src/__tests__/tenant-v2-runner.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Typecheck**

Run: `cd apps/bot && bunx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/bot/src/agents/tenant-v2.ts apps/bot/src/__tests__/tenant-v2-runner.test.ts
git commit -m "feat(tenant): tenant agent prompt + runner (reuses agent-runner)"
```

---

### Task 9: Tenant flow orchestrator — `flows/tenant/index.ts`

**Files:**
- Modify: `apps/bot/src/flows/tenant/index.ts` (replace the 6-line stub)
- Test: `apps/bot/src/flows/tenant/__tests__/index.test.ts`

**Interfaces:**
- Consumes: `buildTenantSnapshot`, `renderTenantContext` from `@/flows/tenant/context`; `getTenantGreetingReply`, `detectEmergency`, `EMERGENCY_REPLY`, `AUDIO_FALLBACK_REPLY` from `@/flows/tenant/intents`; `escalateTenantToOwner` from `@/flows/tenant/escalation`; `detectFrustration` from `@/flows/lead/escalation` (reused, not duplicated); `buildTenantTools` from `@/agents/tenant-tools`; `runTenantAgentV2` from `@/agents/tenant-v2`; `notifyOwner`, `buildTenantEmergencyMessage` from `@/services/notify`; `logActivity` from `@/services/activity`; `sendText` from `@/services/evolution`; `prisma` from `@/db/client`; `MediaItem` type from `@/buffer`
- Produces: `export async function handleTenantMessage(chatId: string, text: string | null, mediaItems: MediaItem[], ownerId: string, tenantId: string, tenantName: string | null): Promise<void>`

This replaces the old 2-argument stub. Task 10 updates the one call site in `router.ts` to match.

**A note on the test's mocking strategy:** do NOT mock `@/flows/tenant/context` wholesale — same reasoning as Task 7. It collides with `context.test.ts` (Task 6), which imports that module for real; bun's `mock.module` is process-global, and whichever file's mock "wins" silently replaces the module for every importer in the run, including files testing it directly. Mock only the leaves `buildTenantSnapshot` touches (`@/db/client`'s `tenant.findUnique`, `@/db/redis`). `@/agents/tenant-v2` and `@/agents/tenant-tools` ARE safe to mock wholesale here — neither Task 7's nor Task 8's test file registers a competing mock for those same paths, so there's no collision to cause.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/bot/src/flows/tenant/__tests__/index.test.ts
import { beforeEach, describe, expect, it, mock } from 'bun:test';

const sentTexts: Array<{ chatId: string; text: string }> = [];
const notifyCalls: Array<{ ownerId: string; eventType: string }> = [];
const activityLogs: Array<Record<string, unknown>> = [];
const events: Array<{ chatId: string; role: string; content: string }> = [];
let conversationUpsertData: Record<string, unknown> | null = null;
let botPausedAfterAgent = false;

const fakeTenantRow = {
  id: 'tenant-1',
  name: 'Maria',
  contractStart: new Date('2026-01-01T00:00:00Z'),
  contractEnd: null,
  property: { id: 'p1', externalId: 'IM-0001', name: 'Kitnet no Retiro', address: 'Rua X', rent: 900 },
  owner: { id: 'owner-1', name: 'Fred', phone: '5511988887777' },
  payments: [],
};
let tenantRowForSnapshot: typeof fakeTenantRow | null = fakeTenantRow;

mock.module('@/db/client', () => ({
  prisma: {
    tenant: { findUnique: async () => tenantRowForSnapshot },
    event: {
      findMany: async () => [],
      create: async (args: { data: { chatId: string; role: string; content: string } }) => {
        events.push(args.data);
        return args.data;
      },
    },
    conversation: {
      findUnique: async () => ({ botPaused: botPausedAfterAgent }),
      upsert: async (args: { update: Record<string, unknown> }) => {
        conversationUpsertData = args.update;
        return {};
      },
    },
    $transaction: async (ops: unknown[]) => ops,
  },
}));

mock.module('@/db/redis', () => ({
  redis: {
    get: async () => null,
    set: async () => 'OK',
    del: async () => 1,
  },
}));

mock.module('@/services/evolution', () => ({
  sendText: async (chatId: string, text: string) => {
    sentTexts.push({ chatId, text });
  },
}));

mock.module('@/services/notify', () => ({
  notifyOwner: async (ownerId: string, eventType: string) => {
    notifyCalls.push({ ownerId, eventType });
  },
}));

mock.module('@/services/activity', () => ({
  logActivity: async (params: Record<string, unknown>) => {
    activityLogs.push(params);
  },
}));

mock.module('@/agents/tenant-v2', () => ({
  runTenantAgentV2: async () => 'Resposta do agente.',
}));

mock.module('@/agents/tenant-tools', () => ({
  buildTenantTools: () => [],
}));

import type { MediaItem } from '@/buffer';
import { handleTenantMessage } from '@/flows/tenant/index';

const noMedia: MediaItem[] = [];

describe('handleTenantMessage', () => {
  beforeEach(() => {
    sentTexts.length = 0;
    notifyCalls.length = 0;
    activityLogs.length = 0;
    events.length = 0;
    conversationUpsertData = null;
    botPausedAfterAgent = false;
    tenantRowForSnapshot = fakeTenantRow;
  });

  it('saudação simples → resposta hardcoded personalizada, sem chamar o agente', async () => {
    await handleTenantMessage('5511999999999@s.whatsapp.net', 'oi', noMedia, 'owner-1', 'tenant-1', 'Maria');
    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0]?.text).toBe('Olá, Maria!');
  });

  it('emergência → resposta hardcoded + notifica owner imediatamente', async () => {
    await handleTenantMessage(
      '5511999999999@s.whatsapp.net',
      'Socorro, tem um incêndio aqui!',
      noMedia,
      'owner-1',
      'tenant-1',
      'Maria',
    );
    expect(sentTexts[0]?.text).toContain('🚨');
    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0]?.eventType).toBe('tenant_emergency');
    expect(activityLogs[0]?.action).toBe('tenant_emergency');
  });

  it('áudio sem texto → resposta hardcoded, sem chamar o agente', async () => {
    const audioItem = { type: 'audio', mime: 'audio/ogg', base64: 'x' } as MediaItem;
    await handleTenantMessage('5511999999999@s.whatsapp.net', null, [audioItem], 'owner-1', 'tenant-1', 'Maria');
    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0]?.text).toContain('áudio');
  });

  it('texto livre → chama o agente e envia a resposta', async () => {
    await handleTenantMessage(
      '5511999999999@s.whatsapp.net',
      'quando vence o aluguel?',
      noMedia,
      'owner-1',
      'tenant-1',
      'Maria',
    );
    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0]?.text).toBe('Resposta do agente.');
    expect(events.some((e) => e.role === 'user' && e.content === 'quando vence o aluguel?')).toBe(true);
    expect(events.some((e) => e.role === 'assistant' && e.content === 'Resposta do agente.')).toBe(true);
  });

  it('agente escalou (botPaused true) → não envia texto extra depois', async () => {
    botPausedAfterAgent = true;
    await handleTenantMessage(
      '5511999999999@s.whatsapp.net',
      'quero negociar o valor',
      noMedia,
      'owner-1',
      'tenant-1',
      'Maria',
    );
    // conv.botPaused=true significa que uma tool (ex: escalar_owner) já avisou o
    // inquilino durante o turno do agente; o orquestrador não deve mandar nada.
    expect(sentTexts).toHaveLength(0);
  });

  it('snapshot ausente → mensagem neutra ao inquilino + notifica owner (regra 8)', async () => {
    tenantRowForSnapshot = null;
    await handleTenantMessage(
      '5511999999999@s.whatsapp.net',
      'quando vence o aluguel?',
      noMedia,
      'owner-1',
      'tenant-1',
      'Maria',
    );
    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0]?.text).toContain('instabilidade');
    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0]?.eventType).toBe('tenant_escalation');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/bot && bun test src/flows/tenant/__tests__/index.test.ts`
Expected: FAIL — `handleTenantMessage` still has the old 2-argument stub signature, tests calling it with 6 args and asserting real behavior fail.

- [ ] **Step 3: Implement `flows/tenant/index.ts`**

```typescript
import { buildTenantTools } from '@/agents/tenant-tools';
import { runTenantAgentV2 } from '@/agents/tenant-v2';
import type { MediaItem } from '@/buffer';
import { prisma } from '@/db/client';
import { detectFrustration } from '@/flows/lead/escalation';
import { buildTenantSnapshot, renderTenantContext } from '@/flows/tenant/context';
import { escalateTenantToOwner } from '@/flows/tenant/escalation';
import {
  AUDIO_FALLBACK_REPLY,
  detectEmergency,
  EMERGENCY_REPLY,
  getTenantGreetingReply,
} from '@/flows/tenant/intents';
import { logger } from '@/lib/logger';
import { logActivity } from '@/services/activity';
import { sendText } from '@/services/evolution';
import { notifyOwner } from '@/services/notify';

const CHAT_HISTORY_LIMIT = 10;

function isAudioMedia(item: MediaItem): boolean {
  return (item.mime ?? '').startsWith('audio/') || (item.type ?? '').startsWith('audio');
}

async function loadChatHistory(
  chatId: string,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const events = await prisma.event.findMany({
    where: { chatId },
    orderBy: { createdAt: 'desc' },
    take: CHAT_HISTORY_LIMIT,
  });
  return events
    .reverse()
    .filter((event) => event.role === 'user' || event.role === 'assistant')
    .map((event) => ({ role: event.role as 'user' | 'assistant', content: event.content }));
}

async function persistTurn(
  chatId: string,
  ownerId: string,
  userMessage: string | null,
  assistantReply: string | null,
): Promise<void> {
  const ops: Array<ReturnType<typeof prisma.event.create>> = [];
  if (userMessage) {
    ops.push(prisma.event.create({ data: { chatId, role: 'user', content: userMessage, ownerId } }));
  }
  if (assistantReply) {
    ops.push(prisma.event.create({ data: { chatId, role: 'assistant', content: assistantReply, ownerId } }));
  }
  await prisma.$transaction(ops);
}

export async function handleTenantMessage(
  chatId: string,
  text: string | null,
  mediaItems: MediaItem[],
  ownerId: string,
  tenantId: string,
  tenantName: string | null,
): Promise<void> {
  logger.info({ chatId }, '[tenant.flow] Message received');

  const messageText = text ?? '';

  try {
    // 1. Emergency — hardcoded, zero LLM, highest priority
    if (detectEmergency(messageText)) {
      await sendText(chatId, EMERGENCY_REPLY);
      await persistTurn(chatId, ownerId, messageText, EMERGENCY_REPLY);

      const snapshot = await buildTenantSnapshot(chatId);
      const propertyName = snapshot?.property.name ?? 'imóvel não identificado';
      const displayName = tenantName ?? chatId;

      notifyOwner(ownerId, 'tenant_emergency', {
        tenantName: displayName,
        tenantPhone: chatId,
        propertyName,
      }).catch((err) => logger.error({ err }, '[tenant.flow] notifyOwner tenant_emergency failed'));

      logActivity({
        ownerId,
        actorType: 'bot',
        actorLabel: 'Bot',
        action: 'tenant_emergency',
        subjectType: 'tenant',
        subjectId: tenantId,
        subject: displayName,
      }).catch((err) => logger.error({ err }, '[tenant.flow] logActivity tenant_emergency failed'));
      return;
    }

    // 2. Greeting — hardcoded, zero LLM (only for pure text, no media)
    if (mediaItems.length === 0) {
      const greeting = getTenantGreetingReply(messageText, tenantName);
      if (greeting) {
        await sendText(chatId, greeting);
        await persistTurn(chatId, ownerId, messageText, greeting);
        return;
      }
    }

    // 3. Audio — hardcoded fallback until T7 (transcription)
    const audioReceived = mediaItems.some(isAudioMedia);
    if (audioReceived && !messageText) {
      await sendText(chatId, AUDIO_FALLBACK_REPLY);
      await persistTurn(chatId, ownerId, null, AUDIO_FALLBACK_REPLY);
      return;
    }

    // 4. Frustration → escalate before spending an LLM call
    if (detectFrustration(messageText)) {
      await escalateTenantToOwner(chatId, ownerId, tenantId, tenantName, 'frustration');
      await persistTurn(chatId, ownerId, messageText || null, null);
      return;
    }

    // 5. Snapshot — factual context for the agent
    const snapshot = await buildTenantSnapshot(chatId);
    if (!snapshot) {
      logger.error({ chatId }, '[tenant.flow] Snapshot ausente — notificando owner');
      notifyOwner(ownerId, 'tenant_escalation', {
        tenantName: tenantName ?? chatId,
        tenantPhone: chatId,
        reason: 'Snapshot do inquilino não encontrado — inconsistência de dados',
      }).catch((err) => logger.error({ err }, '[tenant.flow] notifyOwner snapshot ausente falhou'));
      const neutralReply = 'Estou com uma instabilidade agora. Já avisei a equipe — tente de novo em instantes.';
      await sendText(chatId, neutralReply);
      await persistTurn(chatId, ownerId, messageText || null, neutralReply);
      return;
    }
    const tenantContext = renderTenantContext(snapshot);

    // 6. Chat history + question for the agent
    const chatHistory = await loadChatHistory(chatId);
    const question = messageText || (audioReceived ? 'O usuario enviou um audio sem texto.' : 'O usuario enviou apenas midia.');

    // 7. Run the tenant agent
    const tools = buildTenantTools({ chatId, tenantId, ownerId, tenantName });
    let replyText: string;
    try {
      replyText = await runTenantAgentV2(question, tenantContext, chatHistory, tools);
    } catch (err) {
      logger.error({ err }, '[tenant.flow] runTenantAgentV2 failed');
      replyText = 'Desculpe, tive um problema para processar sua mensagem. Pode tentar de novo?';
    }

    // If the agent escalated (via escalar_owner), the bot is paused and the
    // tenant was already notified inside escalateTenantToOwner — don't send twice.
    const conv = await prisma.conversation.findUnique({ where: { chatId } });
    if (conv?.botPaused) {
      await persistTurn(chatId, ownerId, messageText || null, null);
      return;
    }

    await persistTurn(chatId, ownerId, messageText || null, replyText);
    await sendText(chatId, replyText);
  } catch (err) {
    logger.error({ err }, '[tenant.flow] Unhandled error');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/bot && bun test src/flows/tenant/__tests__/index.test.ts`
Expected: PASS (6 tests — a 6th case, "snapshot ausente", was added during the code-review pass to cover design §7 rule 8, which had zero test coverage until then)

- [ ] **Step 5: Typecheck**

Run: `cd apps/bot && bunx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Run the full bot test suite to check for regressions**

Run: `cd apps/bot && bun test`
Expected: PASS — all existing suites plus the new tenant ones green.

- [ ] **Step 7: Commit**

```bash
git add apps/bot/src/flows/tenant/index.ts apps/bot/src/flows/tenant/__tests__/index.test.ts
git commit -m "feat(tenant): real orchestrator replacing the silent stub

Emergency and greeting are hardcoded (zero LLM). Audio gets a hardcoded
fallback until T7. Everything else runs through the single tenant agent
with escalar_owner as its only tool (T-D7). Every path persists Event
rows; emergency and escalation also write ActivityLog."
```

---

### Task 10: Fix `botPaused` bypass for tenants + wire the new signature — `flows/router.ts`

**Files:**
- Modify: `apps/bot/src/flows/router.ts`
- Test: `apps/bot/src/__tests__/router-bot-paused.test.ts`

**Interfaces:**
- Consumes: `handleTenantMessage(chatId, text, mediaItems, ownerId, tenantId, tenantName)` (new signature from Task 9)
- No new exports — `routeMessage`'s signature is unchanged.

**The bug:** today, `routeMessage` checks `conversation?.botPaused` only in the lead branch, *after* the `if (tenant) { ...; return; }` early return. A paused tenant conversation is never checked — the tenant branch runs unconditionally. This task moves the check above both branches.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/bot/src/__tests__/router-bot-paused.test.ts
import { beforeEach, describe, expect, it, mock } from 'bun:test';

const tenantCalls: unknown[] = [];
const leadCalls: unknown[] = [];
let fakeOwner: { id: string; botEnabled: boolean } | null = { id: 'owner-1', botEnabled: true };
let fakeTenant: { id: string; name: string | null; ownerId: string } | null = null;
let fakeConversation: { botPaused: boolean } | null = null;

mock.module('@/db/client', () => ({
  prisma: {
    owner: { findFirst: async () => fakeOwner },
    lead: { findUnique: async () => null, create: async () => ({ id: 'lead-1', name: null }) },
    tenant: { findUnique: async () => fakeTenant },
    conversation: { findUnique: async () => fakeConversation },
  },
}));

mock.module('@/db/redis', () => ({
  redis: { get: async () => '1', set: async () => 'OK' },
}));

mock.module('@/flows/lead/index', () => ({
  handleLeadMessage: async (...args: unknown[]) => {
    leadCalls.push(args);
  },
}));

mock.module('@/flows/tenant/index', () => ({
  handleTenantMessage: async (...args: unknown[]) => {
    tenantCalls.push(args);
  },
}));

mock.module('@/services/activity', () => ({ logActivity: async () => {} }));

import { routeMessage } from '@/flows/router';

describe('routeMessage — botPaused', () => {
  beforeEach(() => {
    tenantCalls.length = 0;
    leadCalls.length = 0;
    fakeOwner = { id: 'owner-1', botEnabled: true };
    fakeTenant = { id: 'tenant-1', name: 'Maria', ownerId: 'owner-1' };
    fakeConversation = null;
  });

  it('tenant com botPaused=true → NÃO chama handleTenantMessage (bug fixado)', async () => {
    fakeConversation = { botPaused: true };
    await routeMessage('5511999999999@s.whatsapp.net', 'oi', [], 'Maria');
    expect(tenantCalls).toHaveLength(0);
  });

  it('tenant com botPaused=false → chama handleTenantMessage com 6 argumentos corretos', async () => {
    fakeConversation = { botPaused: false };
    await routeMessage('5511999999999@s.whatsapp.net', 'oi', [], 'Maria');
    expect(tenantCalls).toHaveLength(1);
    expect(tenantCalls[0]).toEqual([
      '5511999999999@s.whatsapp.net',
      'oi',
      [],
      'owner-1',
      'tenant-1',
      'Maria',
    ]);
  });

  it('tenant sem Conversation ainda (null) → trata como não pausado, chama handleTenantMessage', async () => {
    fakeConversation = null;
    await routeMessage('5511999999999@s.whatsapp.net', 'oi', [], 'Maria');
    expect(tenantCalls).toHaveLength(1);
  });

  it('lead com botPaused=true → continua suprimido (regressão)', async () => {
    fakeTenant = null;
    fakeConversation = { botPaused: true };
    await routeMessage('5511999999999@s.whatsapp.net', 'oi', [], null);
    expect(leadCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/bot && bun test src/__tests__/router-bot-paused.test.ts`
Expected: FAIL — current `router.ts` calls `handleTenantMessage` with the old 2-arg signature and never checks `botPaused` for tenants, so the first test (`tenantCalls` should have length 0) fails.

- [ ] **Step 3: Fix `flows/router.ts`**

Replace the whole function body with:

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

  // Per-chat pause applies to BOTH tenant and lead conversations — checked
  // once, before branching, so neither path can bypass it.
  if (conversation?.botPaused) {
    logger.info({ chatId }, '[router] Bot paused — message suppressed');
    return;
  }

  if (tenant) {
    await handleTenantMessage(chatId, text, mediaItems, tenant.ownerId, tenant.id, tenant.name);
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

The only behavioral changes: (1) the `botPaused` check now runs before the `tenant` branch instead of only being reachable from the lead branch; (2) `handleTenantMessage` is called with the tenant's `ownerId`, `id`, and `name` (already fetched by the existing `prisma.tenant.findUnique` — no new query) instead of just `chatId, text`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/bot && bun test src/__tests__/router-bot-paused.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Typecheck**

Run: `cd apps/bot && bunx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Run the full bot test suite**

Run: `cd apps/bot && bun test`
Expected: PASS — every suite green, including the pre-existing `webhook-extract.test.ts` and all tenant/T1 suites added in this plan.

- [ ] **Step 7: Commit**

```bash
git add apps/bot/src/flows/router.ts apps/bot/src/__tests__/router-bot-paused.test.ts
git commit -m "fix(router): honor botPaused for tenant conversations (was bypassed)

The tenant branch returned before the botPaused check, so pausing a
tenant chat from the admin panel had no effect on the bot. Moved the
check above both branches. Also wires the tenant's id/name/ownerId
into handleTenantMessage's new signature instead of re-querying them."
```

---

## Final verification (run once, after Task 10)

- [ ] Run: `cd apps/bot && bun test` — full suite green
- [ ] Run: `cd apps/bot && bunx tsc --noEmit` — clean
- [ ] Run: `cd apps/web && bunx tsc --noEmit` — clean (no web changes in T1, but confirms nothing in `packages/types` broke it)
- [ ] Manual read-through: confirm `flows/tenant/index.ts` never sends a reply without persisting an `Event` row first (regra 6 — every relevant interaction is recorded)
- [ ] Update `PRD-FASE2.md` §T1: check off every completed build step, then run the slice through `agent-skills:code-simplification` (etapa 5) and `agent-skills:code-review-and-quality` (etapa 6) before opening the PR, per the pipeline in `PRD-FASE2.md`.
