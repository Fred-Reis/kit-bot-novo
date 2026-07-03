# Lead Flow v2 — Fase B: Agente único com tools — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir router LLM + 4 agentes especializados por UM agente conversacional com function calling, atrás de feature flag (`LEAD_FLOW_V2`). Tools leem/escrevem o banco; o LLM nunca carrega estado do funil.

**Architecture:** Hoje cada turno de texto livre custa 3 chamadas LLM (extractor → router → agente) com regras duplicadas em 6 prompts (`apps/bot/src/agents/lead.ts`). Nesta fase, router + 4 agentes viram 1 agente com tools (`status_checklist`, `registrar_renda`, `registrar_moradores`, `info_imovel`, `agendar_visita`, `cancelar_visita`, `escalar_humano`). O extractor é mantido nesta fase (fornece `intent`/`propertyInterest` ao FSM) e sua remoção fica para a task de cutover. Pipeline determinístico de docs, gate de confirmação, escalação e saudações (Fase A) não mudam.

**Tech Stack:** Bun + TypeScript strict, LangChain JS (`@langchain/openai`, `@langchain/core` — já dependências), GPT-4o mini, Zod, `bun test`.

## Global Constraints

- Usar **bun**; comandos em `apps/bot/`. Typecheck `bunx tsc --noEmit`; testes `bun test`; lint `bunx oxlint src`.
- Imports com alias `@/`. **Não usar Python.** Mensagens ao lead em pt-BR.
- **PRÉ-REQUISITO:** Fase A Tasks 2, 3 e 7 mergeadas em main (contrato: `@/services/doc-classifier`, `@/flows/lead/checklist`, `@/flows/lead/escalation` — assinaturas no `2026-07-02-lead-flow-v2-README.md`). Tasks 1–3 deste plan compilam só com o contrato; a Task 4 exige a Fase A completa mergeada.
- Flag `LEAD_FLOW_V2` default `false` — produção continua no fluxo atual até o Fred virar a chave.
- **Git:** branch `feat/lead-flow-v2-fase-b`, criada de `main` após a PR do contrato (`feat/lead-flow-v2-contract`) ser mergeada. Após a Task 3, abrir **PR draft**; após a Fase A mergeada, rebase + Task 4 + marcar "ready for review" (steps no plan). Task 5 (cutover) é branch/PR separada (`feat/lead-flow-v2-cutover`), só após validação em produção autorizada pelo Fred. **Nunca commitar/pushar em `main`; merge é do Fred via PR.**

---

### Task 1: Feature flag `LEAD_FLOW_V2`

**Files:**
- Modify: `apps/bot/src/config.ts`

**Interfaces:**
- Produces: `config.LEAD_FLOW_V2: boolean` (default `false`).

- [ ] **Step 1: Adicionar ao schema Zod de `config.ts`** (junto às outras flags):

```ts
  LEAD_FLOW_V2: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1')
    .pipe(z.boolean()),
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/bot && bunx tsc --noEmit`
Expected: sem erros

- [ ] **Step 3: Commit**

```bash
git add apps/bot/src/config.ts
git commit -m "bot: feature flag LEAD_FLOW_V2"
```

---

### Task 2: Tools do agente

**Files:**
- Create: `apps/bot/src/agents/tools.ts`
- Test: `apps/bot/src/__tests__/agent-tools.test.ts`

**Interfaces:**
- Consumes (contrato Fase A): `getChecklistForLead`, `renderChecklistText` de `@/flows/lead/checklist`; `escalateToHuman` de `@/flows/lead/escalation`; `parseIncomeValue` de `@/flows/lead/income`; `getPropertyByExternalId`, `describeProperty`, `describePropertyTerms` de `@/services/catalog`; `prisma` de `@/db/client`.
- Produces:

```ts
export interface ToolDeps {
  chatId: string;
  leadId: string;
  ownerId: string;
  leadName: string | null;
  propertyExternalId: string | null; // imóvel em foco, se houver
}
export function buildLeadTools(deps: ToolDeps): StructuredToolInterface[];
```

Toda tool retorna **string** (fato do banco) que o agente repassa/parafraseia. Tools nunca lançam para o LLM: erro vira string "Erro: ...".

- [ ] **Step 1: Testes que falham (executores com prisma mockado)**

```ts
// apps/bot/src/__tests__/agent-tools.test.ts
import { beforeEach, describe, expect, it, mock } from 'bun:test';

const leadUpdates: Array<Record<string, unknown>> = [];
let fakeLead: Record<string, unknown> = {};

mock.module('@/db/client', () => ({
  prisma: {
    lead: {
      findUnique: async () => fakeLead,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        leadUpdates.push(data);
        return { ...fakeLead, ...data };
      },
    },
    leadDocument: { findMany: async () => [] },
    leadResident: {
      count: async () => 0,
      deleteMany: async () => ({}),
      createMany: async () => ({}),
    },
    $transaction: async (ops: unknown[]) => ops,
    conversation: { upsert: async () => ({}) },
  },
}));

mock.module('@/services/evolution', () => ({ sendText: async () => {}, sendMedia: async () => {} }));
mock.module('@/services/notify', () => ({ notifyOwner: async () => {} }));
mock.module('@/services/catalog', () => ({
  getPropertyByExternalId: async (id: string) =>
    id === 'IM01' ? { externalId: 'IM01', name: 'Kitnet Retiro', active: true } : null,
  describeProperty: () => 'Kitnet no Retiro, R$ 800',
  describePropertyTerms: () => 'Caução 2x, sem pets',
}));

import { buildLeadTools } from '@/agents/tools';

const deps = {
  chatId: '5511999999999@s.whatsapp.net',
  leadId: 'lead-1',
  ownerId: 'owner-1',
  leadName: 'Frederico',
  propertyExternalId: 'IM01',
};

function getTool(name: string) {
  const t = buildLeadTools(deps).find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} não encontrada`);
  return t;
}

describe('registrar_renda', () => {
  beforeEach(() => {
    leadUpdates.length = 0;
    fakeLead = { name: 'Frederico', declaredIncome: null, expectedResidents: 1 };
  });

  it('persiste valor e retorna checklist', async () => {
    const out = (await getTool('registrar_renda').invoke({ valorMensal: 12000 })) as string;
    expect(leadUpdates[0]).toEqual({ declaredIncome: 12000 });
    expect(out).toContain('Renda registrada');
  });

  it('valor inválido → erro em string, sem update', async () => {
    const out = (await getTool('registrar_renda').invoke({ valorMensal: -5 })) as string;
    expect(leadUpdates.length).toBe(0);
    expect(out).toContain('Erro');
  });
});

describe('agendar_visita', () => {
  beforeEach(() => {
    leadUpdates.length = 0;
    fakeLead = { name: 'Frederico', scheduledVisitAt: null };
  });

  it('data futura → persiste e confirma com data formatada', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const out = (await getTool('agendar_visita').invoke({ dataHoraIso: future })) as string;
    expect(leadUpdates[0]?.scheduledVisitAt).toBeInstanceOf(Date);
    expect(out).toContain('✅ Visita confirmada');
  });

  it('data passada → erro, sem persistir', async () => {
    const out = (await getTool('agendar_visita').invoke({
      dataHoraIso: '2020-01-01T10:00:00-03:00',
    })) as string;
    expect(leadUpdates.length).toBe(0);
    expect(out).toContain('Erro');
  });
});

describe('info_imovel', () => {
  it('retorna fatos do imóvel em foco', async () => {
    const out = (await getTool('info_imovel').invoke({ externalId: null })) as string;
    expect(out).toContain('Kitnet no Retiro');
    expect(out).toContain('Caução 2x');
  });
});

describe('lista completa', () => {
  it('expõe as 7 tools', () => {
    const names = buildLeadTools(deps).map((t) => t.name).sort();
    expect(names).toEqual([
      'agendar_visita',
      'cancelar_visita',
      'escalar_humano',
      'info_imovel',
      'registrar_moradores',
      'registrar_renda',
      'status_checklist',
    ]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/bot && bun test agent-tools`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `tools.ts`**

```ts
// apps/bot/src/agents/tools.ts
import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { prisma } from '@/db/client';
import { getChecklistForLead, renderChecklistText } from '@/flows/lead/checklist';
import { escalateToHuman } from '@/flows/lead/escalation';
import { logger } from '@/lib/logger';
import {
  describeProperty,
  describePropertyTerms,
  getPropertyByExternalId,
} from '@/services/catalog';

export interface ToolDeps {
  chatId: string;
  leadId: string;
  ownerId: string;
  leadName: string | null;
  propertyExternalId: string | null;
}

const VISIT_TZ = 'America/Sao_Paulo';

function fail(msg: string): string {
  return `Erro: ${msg}`;
}

async function checklistText(leadId: string): Promise<string> {
  const checklist = await getChecklistForLead(leadId);
  return renderChecklistText(checklist);
}

export function buildLeadTools(deps: ToolDeps): StructuredToolInterface[] {
  const statusChecklist = tool(
    async () => {
      try {
        return `Status da análise:\n${await checklistText(deps.leadId)}`;
      } catch (err) {
        logger.error({ err }, '[tools] status_checklist');
        return fail('não consegui consultar o checklist agora.');
      }
    },
    {
      name: 'status_checklist',
      description:
        'Consulta no banco o status real do checklist de análise do lead (renda, documentos, moradores). Use SEMPRE antes de afirmar qualquer coisa sobre documentos ou pendências.',
      schema: z.object({}),
    },
  );

  const registrarRenda = tool(
    async ({ valorMensal }: { valorMensal: number }) => {
      if (!Number.isFinite(valorMensal) || valorMensal <= 0) {
        return fail('valor de renda inválido.');
      }
      try {
        await prisma.lead.update({
          where: { id: deps.leadId },
          data: { declaredIncome: valorMensal },
        });
        return `Renda registrada: R$ ${valorMensal.toLocaleString('pt-BR')}.\n${await checklistText(deps.leadId)}`;
      } catch (err) {
        logger.error({ err }, '[tools] registrar_renda');
        return fail('não consegui registrar a renda agora.');
      }
    },
    {
      name: 'registrar_renda',
      description:
        'Registra a renda mensal declarada pelo lead (número em reais). Comprovante é opcional e não bloqueia.',
      schema: z.object({ valorMensal: z.number().describe('Renda mensal em reais, ex: 12000') }),
    },
  );

  const registrarMoradores = tool(
    async ({
      total,
      moradores,
    }: {
      total: number | null;
      moradores: Array<{ name: string; sex: string; age: number }>;
    }) => {
      try {
        if (total != null && total > 0) {
          await prisma.lead.update({
            where: { id: deps.leadId },
            data: { expectedResidents: total },
          });
        }
        if (moradores.length > 0) {
          await prisma.$transaction([
            prisma.leadResident.deleteMany({ where: { leadId: deps.leadId } }),
            prisma.leadResident.createMany({
              data: moradores.map((m) => ({
                leadId: deps.leadId,
                ownerId: deps.ownerId,
                name: m.name,
                sex: m.sex || null,
                age: m.age ?? null,
              })),
            }),
          ]);
        }
        return `Moradores atualizados.\n${await checklistText(deps.leadId)}`;
      } catch (err) {
        logger.error({ err }, '[tools] registrar_moradores');
        return fail('não consegui registrar os moradores agora.');
      }
    },
    {
      name: 'registrar_moradores',
      description:
        'Registra a quantidade total de moradores (quando o lead informar) e/ou a lista de moradores com nome, sexo e idade. Envie a lista COMPLETA a cada chamada (substitui a anterior).',
      schema: z.object({
        total: z.number().int().nullable().describe('Quantidade total de pessoas que vão morar; null se não informado'),
        moradores: z.array(
          z.object({ name: z.string(), sex: z.string(), age: z.number().int() }),
        ),
      }),
    },
  );

  const infoImovel = tool(
    async ({ externalId }: { externalId: string | null }) => {
      const id = externalId ?? deps.propertyExternalId;
      if (!id) return fail('nenhum imóvel em foco.');
      try {
        const property = await getPropertyByExternalId(id);
        if (!property || !property.active) return fail(`imóvel ${id} não encontrado ou inativo.`);
        return `${describeProperty(property)}\n\nCondições:\n${describePropertyTerms(property)}`;
      } catch (err) {
        logger.error({ err }, '[tools] info_imovel');
        return fail('não consegui consultar o imóvel agora.');
      }
    },
    {
      name: 'info_imovel',
      description:
        'Consulta fatos do imóvel no banco (valor, regras, localização, condições). Use antes de responder QUALQUER pergunta factual sobre imóvel. externalId null usa o imóvel em foco.',
      schema: z.object({ externalId: z.string().nullable() }),
    },
  );

  const agendarVisita = tool(
    async ({ dataHoraIso }: { dataHoraIso: string }) => {
      const date = new Date(dataHoraIso);
      if (isNaN(date.getTime())) return fail('data/hora inválida.');
      if (date <= new Date()) return fail('a data da visita precisa ser no futuro.');
      try {
        await prisma.lead.update({
          where: { id: deps.leadId },
          data: { scheduledVisitAt: date },
        });
        const dateStr = date.toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          timeZone: VISIT_TZ,
        });
        const timeStr = date.toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: VISIT_TZ,
        });
        return `✅ Visita confirmada para ${dateStr} às ${timeStr}. Repasse esta confirmação ao lead.`;
      } catch (err) {
        logger.error({ err }, '[tools] agendar_visita');
        return fail('não consegui agendar agora.');
      }
    },
    {
      name: 'agendar_visita',
      description:
        'Agenda ou reagenda a visita quando o lead confirmar DATA e HORA específicas. Formato ISO com offset -03:00, ex: 2026-07-05T14:00:00-03:00. Visita é OPCIONAL — nunca insista.',
      schema: z.object({ dataHoraIso: z.string() }),
    },
  );

  const cancelarVisita = tool(
    async () => {
      try {
        await prisma.lead.update({
          where: { id: deps.leadId },
          data: { scheduledVisitAt: null },
        });
        return 'Visita cancelada com sucesso. Confirme ao lead de forma breve e positiva, sem questionar.';
      } catch (err) {
        logger.error({ err }, '[tools] cancelar_visita');
        return fail('não consegui cancelar agora.');
      }
    },
    {
      name: 'cancelar_visita',
      description: 'Cancela a visita agendada quando o lead pedir. Nunca questione o cancelamento.',
      schema: z.object({}),
    },
  );

  const escalarHumano = tool(
    async ({ motivo }: { motivo: string }) => {
      try {
        await escalateToHuman(deps.chatId, deps.ownerId, deps.leadName, 'human_request');
        logger.info({ motivo }, '[tools] escalar_humano');
        return 'Atendimento escalado para humano; o bot foi pausado. NÃO envie mais nada — o sistema já avisou o lead.';
      } catch (err) {
        logger.error({ err }, '[tools] escalar_humano');
        return fail('não consegui escalar agora.');
      }
    },
    {
      name: 'escalar_humano',
      description:
        'Pausa o bot e chama um atendente humano. Use quando o lead pedir para falar com pessoa, estiver insatisfeito, ou quando você não conseguir resolver com as outras tools.',
      schema: z.object({ motivo: z.string() }),
    },
  );

  return [
    statusChecklist,
    registrarRenda,
    registrarMoradores,
    infoImovel,
    agendarVisita,
    cancelarVisita,
    escalarHumano,
  ];
}
```

- [ ] **Step 4: Rodar e ver passar + typecheck**

Run: `cd apps/bot && bun test agent-tools && bunx tsc --noEmit`
Expected: PASS / sem erros

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/agents/tools.ts apps/bot/src/__tests__/agent-tools.test.ts
git commit -m "agent: tools de banco para o agente unico"
```

---

### Task 3: Runner do agente único (LLM injetável)

**Files:**
- Create: `apps/bot/src/agents/lead-v2.ts`
- Test: `apps/bot/src/__tests__/lead-v2-runner.test.ts`

**Interfaces:**
- Consumes: `buildLeadTools`/`ToolDeps` (Task 2), `makeLLM`-style factory local, `config`.
- Produces:

```ts
export interface BoundLLM {
  invoke(messages: BaseMessage[]): Promise<AIMessage>;
}
export async function runLeadAgentV2(
  question: string,
  leadContext: string,
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  tools: StructuredToolInterface[],
  llm?: BoundLLM, // default: ChatOpenAI(gpt-4o-mini).bindTools(tools)
): Promise<string>;
```

- [ ] **Step 1: Teste com LLM fake roteirizado — escrever e ver falhar**

```ts
// apps/bot/src/__tests__/lead-v2-runner.test.ts
import { describe, expect, it } from 'bun:test';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { runLeadAgentV2 } from '@/agents/lead-v2';

const echoTool = tool(async () => 'Status da análise:\n⬜ Renda', {
  name: 'status_checklist',
  description: 'x',
  schema: z.object({}),
});

function scriptedLLM(responses: AIMessage[]) {
  let i = 0;
  return {
    invoke: async (_messages: BaseMessage[]) => responses[Math.min(i++, responses.length - 1)],
  };
}

describe('runLeadAgentV2', () => {
  it('sem tool calls → devolve o texto direto', async () => {
    const llm = scriptedLLM([new AIMessage('Olá! Como posso ajudar?')]);
    const out = await runLeadAgentV2('oi', 'ctx', [], [echoTool], llm);
    expect(out).toBe('Olá! Como posso ajudar?');
  });

  it('com tool call → executa e usa o resultado na resposta final', async () => {
    const withCall = new AIMessage({
      content: '',
      tool_calls: [{ id: 'c1', name: 'status_checklist', args: {} }],
    });
    const final = new AIMessage('Falta a renda mensal. Pode me informar?');
    const llm = scriptedLLM([withCall, final]);
    const out = await runLeadAgentV2('o que falta?', 'ctx', [], [echoTool], llm);
    expect(out).toBe('Falta a renda mensal. Pode me informar?');
  });

  it('estoura o limite de rounds → fallback educado', async () => {
    const withCall = new AIMessage({
      content: '',
      tool_calls: [{ id: 'c1', name: 'status_checklist', args: {} }],
    });
    const llm = scriptedLLM([withCall, withCall, withCall, withCall]);
    const out = await runLeadAgentV2('?', 'ctx', [], [echoTool], llm);
    expect(out).toContain('tentar de novo');
  });
});
```

Run: `cd apps/bot && bun test lead-v2-runner`
Expected: FAIL — módulo não existe.

- [ ] **Step 2: Implementar `lead-v2.ts`**

```ts
// apps/bot/src/agents/lead-v2.ts
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

const MAX_TOOL_ROUNDS = 3;

const FALLBACK_REPLY =
  'Desculpe, tive um problema para processar sua mensagem. Pode tentar de novo?';

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

Conversa:
- Responda primeiro a pergunta atual. Maximo UMA pergunta por mensagem.
- Saudacao recebe saudacao curta, sem triagem.
- Nunca mencione URLs ou links de midia; o sistema envia midia automaticamente.
- Se o lead pedir humano, estiver irritado ou voce nao conseguir resolver: chame escalar_humano e NAO envie mais nada.
- Cancelamento/reagendamento de visita: sempre permitido, sem resistencia (use as tools).
- Tom: cordial, direto, breve.`;

export interface BoundLLM {
  invoke(messages: BaseMessage[]): Promise<AIMessage>;
}

function makeDefaultLLM(tools: StructuredToolInterface[]): BoundLLM {
  const llm = new ChatOpenAI({
    model: config.OPENAI_MODEL_NAME,
    temperature: 0,
    maxTokens: 600,
    openAIApiKey: config.OPENAI_API_KEY,
  });
  return llm.bindTools(tools) as unknown as BoundLLM;
}

export async function runLeadAgentV2(
  question: string,
  leadContext: string,
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  tools: StructuredToolInterface[],
  llm?: BoundLLM,
): Promise<string> {
  const bound = llm ?? makeDefaultLLM(tools);
  const toolsByName = new Map(tools.map((t) => [t.name, t]));

  const messages: BaseMessage[] = [
    new SystemMessage(LEAD_AGENT_V2_PROMPT),
    ...chatHistory.map((m) =>
      m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content),
    ),
    new HumanMessage(`Contexto do sistema:\n${leadContext}\n\nMensagem do usuario:\n${question}`),
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
          logger.error({ err, tool: call.name }, '[lead-v2] tool falhou');
          result = 'Erro: a tool falhou.';
        }
        messages.push(new ToolMessage({ content: result, tool_call_id: call.id ?? call.name }));
      }
    }
  } catch (err) {
    logger.error({ err }, '[lead-v2] runner falhou');
  }

  return FALLBACK_REPLY;
}
```

- [ ] **Step 3: Rodar e ver passar + typecheck**

Run: `cd apps/bot && bun test lead-v2-runner && bunx tsc --noEmit`
Expected: PASS / sem erros

- [ ] **Step 4: Commit**

```bash
git add apps/bot/src/agents/lead-v2.ts apps/bot/src/__tests__/lead-v2-runner.test.ts
git commit -m "agent: runner do agente unico com tools e LLM injetavel"
```

- [ ] **Step 5: Abrir PR draft** (Task 4 depende da Fase A mergeada — a PR fica draft até lá)

```bash
git push -u origin feat/lead-flow-v2-fase-b
gh pr create --draft \
  --title "feat(bot): lead flow v2 fase B — agente único com tools (flag LEAD_FLOW_V2)" \
  --body "$(cat <<'EOF'
## Resumo
Fase B do Lead Flow v2 (plan: docs/superpowers/plans/2026-07-02-lead-flow-v2-fase-b-agente-tools.md).

- Flag `LEAD_FLOW_V2` (default false — zero mudança de comportamento em produção)
- 7 tools de banco (`status_checklist`, `registrar_renda`, `registrar_moradores`, `info_imovel`, `agendar_visita`, `cancelar_visita`, `escalar_humano`)
- Runner do agente único com LLM injetável (testável sem rede)

**Draft até a PR da Fase A ser mergeada** — a Task 4 (wiring no flow) depende dela.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

### Task 4: Wiring no flow atrás da flag (REQUER FASE A MERGEADA)

**Files:**
- Modify: `apps/bot/src/flows/lead/index.ts`

**Interfaces:**
- Consumes: `runLeadAgentV2` (Task 3), `buildLeadTools` (Task 2), `config.LEAD_FLOW_V2` (Task 1), snapshot da Fase A (`snapshot.checklist`, `renderLeadContext`).

Comportamento com flag ON: extractor continua (alimenta `intent`/`propertyInterest`/FSM), MAS (a) router + 4 agentes são substituídos pelo agente único, (b) escrita de visita do extractor é desligada — `agendar_visita`/`cancelar_visita` viram os únicos escritores de `scheduledVisitAt`, eliminando escrita dupla.

- [ ] **Step 1: Imports em `index.ts`**

```ts
import { runLeadAgentV2 } from '@/agents/lead-v2';
import { buildLeadTools } from '@/agents/tools';
import { config } from '@/config';
```

- [ ] **Step 2: Desligar escrita de visita do extractor quando flag ON**

Envolver o bloco `if (visitCancelled) {...} else if (extractedVisitAt) {...}` (seção 5):

```ts
      if (!config.LEAD_FLOW_V2) {
        if (visitCancelled) {
          leadPatch.scheduledVisitAt = null;
          context.wantsSchedule = false;
          context.visitRequested = false;
          visitCancelledThisTurn = true;
        } else if (extractedVisitAt) {
          const proposedDate = new Date(extractedVisitAt);
          if (!isNaN(proposedDate.getTime()) && proposedDate > new Date()) {
            leadPatch.scheduledVisitAt = proposedDate;
          }
        }
      }
```

O bloco "Visit confirmation: fire on every new/changed visit date" também fica atrás de `if (!config.LEAD_FLOW_V2)` — na v2 a confirmação vem da tool.

- [ ] **Step 3: Substituir a seção `// 13. Route and run agent`**

```ts
    // 13. Route and run agent (unless deterministic media bypass)
    let targetAgent: string = 'info';
    if (!bypassAgentReply) {
      if (config.LEAD_FLOW_V2) {
        targetAgent = 'lead_v2';
        const tools = buildLeadTools({
          chatId,
          leadId: lead.id,
          ownerId: lead.ownerId,
          leadName: lead.name,
          propertyExternalId: snapshot.propertyInFocus?.externalId ?? null,
        });
        replyText = await runLeadAgentV2(question, leadContextStr, chatHistory, tools);

        // Se o agente escalou, o bot foi pausado e o sistema já avisou o lead
        const conv = await prisma.conversation.findUnique({ where: { chatId } });
        if (conv?.botPaused) {
          await persistConversation(chatId, context, messageText || null, null, ownerId);
          return;
        }
      } else {
        const routedAgent = visitCancelledThisTurn
          ? 'scheduling'
          : await routeLeadMessage(question, leadContextStr);
        targetAgent = visitCancelledThisTurn
          ? 'scheduling'
          : resolveTargetAgent(snapshot.state, routedAgent);
        replyText = await runLeadAgent(
          targetAgent as Parameters<typeof runLeadAgent>[0],
          question,
          leadContextStr,
          chatHistory,
        );
      }
    } else {
      targetAgent = 'deterministic_media';
    }
```

- [ ] **Step 4: Rodar tudo + typecheck**

Run: `cd apps/bot && bun test && bunx tsc --noEmit`
Expected: PASS / sem erros (flag OFF por default → comportamento atual intacto)

- [ ] **Step 5: Smoke test local com flag ON**

Adicionar `LEAD_FLOW_V2=true` ao `.env` local. `docker compose up -d --build bot && docker compose logs -f bot`.
Roteiro no WhatsApp de teste: "oi" (saudação hardcoded) → "quanto é o aluguel?" (agente deve chamar `info_imovel`) → "minha renda é 12 mil" (deve chamar `registrar_renda` e citar o checklist) → "quero falar com uma pessoa" (deve chamar `escalar_humano`, bot pausa).
Verificar nos logs as tool calls e a ausência de chamadas ao router antigo.

- [ ] **Step 6: Commit + marcar a PR como ready**

Antes do commit: `git fetch origin && git rebase origin/main` (traz a Fase A mergeada; resolver conflitos em `flows/lead/index.ts` mantendo o snapshot/checklist da Fase A).

```bash
git add apps/bot/src/flows/lead/index.ts
git commit -m "flow: agente unico com tools atras da flag LEAD_FLOW_V2"
git push --force-with-lease
gh pr ready
```

Rodar a skill `coderabbit:code-review` no diff da branch e resolver findings relevantes (fallback: `/code-review`); o app do CodeRabbit revisará a PR ao sair de draft. Atualizar o body (remover a nota de draft) e reportar a URL ao Fred — merge é dele, após os reviews.

---

### Task 5: Cutover (GATED — só com autorização do Fred após validação em produção)

**Files:**
- Modify: `apps/bot/src/flows/lead/index.ts`, `apps/bot/src/agents/lead.ts`, `apps/bot/src/flows/lead/rules.ts`, `apps/bot/src/flows/lead/context.ts`, `apps/bot/src/config.ts`
- Delete: testes dos módulos removidos

Critérios de saída do canário (Fred avalia): 1 semana com `LEAD_FLOW_V2=true` em produção sem escalações por `loop`, sem regressão de funil no painel.

- [ ] **Step 1: Remover o caminho antigo**

- `agents/lead.ts`: remover `ROUTER_SYSTEM_PROMPT`, `RouterSchema`, `routeLeadMessage`, `runLeadAgent`, `OPTIONS_AGENT_PROMPT`, `INFO_AGENT_PROMPT`, `SCHEDULING_AGENT_PROMPT`, `COLLECTION_AGENT_PROMPT`, `AGENT_PROMPTS`. Manter `extractLeadUpdate` (agora sem `visit_date`/`visit_time`/`visit_cancelled` — remover do schema e do retorno).
- `flows/lead/rules.ts`: deletar arquivo + `rules.test.ts` (roteamento por estado não existe mais).
- `flows/lead/index.ts`: remover o branch `else` da flag, os `if (!config.LEAD_FLOW_V2)` (código v1 dentro deles morre), `visitCancelledThisTurn` e imports mortos.
- `flows/lead/context.ts`: remover do `LeadContext` os campos que só o caminho antigo usava: `docsPreference`, `residentsComplete`, `income` (migrar leitura para `lead.declaredIncome` na chamada de `parseIncomeValue` — remover também o patch da Fase A Task 8, tool é o escritor), `visitConfirmationSent`.
- `config.ts`: remover `LEAD_FLOW_V2` (v2 vira o único caminho).

- [ ] **Step 2: Rodar tudo**

Run: `cd apps/bot && bun test && bunx tsc --noEmit && bunx oxlint src`
Expected: verde; `grep -rn "routeLeadMessage\|resolveTargetAgent\|AGENT_PROMPTS" apps/bot/src` sem resultados.

- [ ] **Step 3: Commit + PR do cutover**

Trabalhar em branch própria criada de `main`: `git checkout -b feat/lead-flow-v2-cutover origin/main` (antes do Step 1).

```bash
git add -A apps/bot/src
git commit -m "flow: cutover para agente unico — remover router e agentes antigos"
git push -u origin feat/lead-flow-v2-cutover
gh pr create \
  --title "refactor(bot): cutover lead flow v2 — remover router e agentes antigos" \
  --body "$(cat <<'EOF'
Task 5 da Fase B. Remove extractor de visita, router LLM e os 4 prompts antigos;
LEAD_FLOW_V2 deixa de existir (v2 vira o único caminho).

Pré-condição validada pelo Fred: 1 semana de canário em produção sem escalações
por loop e sem regressão de funil.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review (executar ao final das Tasks 1–4)

1. Flag OFF → `bun test` verde e zero mudança de comportamento (diff de runtime só dentro de `if (config.LEAD_FLOW_V2)`).
2. Nenhuma tool lança exceção para o LLM — tudo vira string `Erro: ...`.
3. Assinaturas consumidas do contrato da Fase A conferem com `2026-07-02-lead-flow-v2-README.md`.
4. Prompt v2 não contradiz os comportamentos determinísticos (saudação, doc intake, gate de confirmação continuam fora do LLM).
