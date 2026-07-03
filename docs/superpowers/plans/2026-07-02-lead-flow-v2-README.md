# Lead Flow v2 — Coordenação dos plans

Spec de origem: `docs/lead-flow-v2.md`. Três plans, cada um executável por agente com contexto zero:

| Plan | Arquivo | Escopo |
|---|---|---|
| Fase 0 | `2026-07-02-lead-flow-v2-fase-0-hotfix.md` | Hotfix produção: bucket, upload falho, feedback de recebimento, webhook |
| Fase A | `2026-07-02-lead-flow-v2-fase-a-doc-pipeline.md` | Pipeline determinístico de docs + checklist + escalação |
| Fase B | `2026-07-02-lead-flow-v2-fase-b-agente-tools.md` | Agente único com tools atrás de feature flag |

## Grafo de dependências e paralelismo

```
Fase 0 (pequena, ~4 tasks) ── landa primeiro, sozinha
        │
        ▼
Fase A Tasks 2+3 (classifier + checklist — SÃO O CONTRATO) ── landar cedo em main
        │
        ├──────────────────────────────┐
        ▼                              ▼
Fase A Tasks 1,4-10                Fase B Tasks 1-3
(worktree A, paralelo)             (worktree B, paralelo — importa o contrato)
        │                              │
        ▼                              │
Fase A Task 10 (integração) ── merge   │
                                       ▼
                             Fase B Task 4 (wiring, precisa de A merged)
                                       ▼
                             Fase B Task 5 (cutover — só após validação em prod)
```

**Regra de conflito:** Fase A e Fase B tocam `flows/lead/index.ts`. Só as tasks de
integração (A10, B4) mexem nele — por isso são sequenciais. Todo o resto é módulo novo.

## Execução com múltiplos agentes — estratégia de PR

1. Cada fase em worktree próprio — usar skill `superpowers:using-git-worktrees`.
2. Dentro de cada worktree, executar o plan com `superpowers:subagent-driven-development`
   (agente novo por task + review entre tasks) ou `superpowers:executing-plans`.
3. **Fluxo git:** agentes commitam na feature branch do worktree e, ao final do plan,
   fazem push e abrem PR com `gh pr create`. **Merge é exclusivo do Fred**, via review
   da PR. Nenhum agente commita ou pusha em `main`.

### Mapa de branches/PRs

| Branch | Conteúdo | PR → main | Quando |
| --- | --- | --- | --- |
| `feat/lead-flow-v2-fase-0` | Fase 0 completa | PR 1 | imediato |
| `feat/lead-flow-v2-contract` | Fase A Tasks 2+3 (classifier + checklist) | PR 2 | imediato — **mergear cedo, desbloqueia B** |
| `feat/lead-flow-v2-fase-a` | Fase A Tasks 1, 4–10 | PR 3 | criada de main após PR 2 mergeada |
| `feat/lead-flow-v2-fase-b` | Fase B Tasks 1–4 | PR 4 (**draft**) | criada de main após PR 2; vira "ready" + rebase após PR 3 mergeada (Task 4 depende da Fase A) |
| `feat/lead-flow-v2-cutover` | Fase B Task 5 | PR 5 | só após canário em produção autorizado pelo Fred |

### Política de code review

**Primário: CodeRabbit.** Fallback: `/code-review` nativo (usar apenas se o CodeRabbit estiver indisponível — CLI sem auth, quota, outage).

- **Na PR (CI):** o app do CodeRabbit revisa automaticamente todo push para PR não-draft
  contra `main` (config em `.coderabbit.yaml` na raiz). Resolver/responder os comentários
  antes do merge.
- **Local (antes do push):** rodar a skill `coderabbit:code-review` no diff da branch.
  Correções triviais apontadas pelo review podem ser aplicadas com `coderabbit:autofix`.
- **Fallback:** `/code-review` (skill nativa) com o mesmo escopo.

## Contrato congelado entre A e B

Fase B importa de Fase A (assinaturas exatas nos dois plans — não alterar sem atualizar ambos):

```ts
// apps/bot/src/services/doc-classifier.ts
export type LeadDocumentType =
  | 'cnh_front' | 'cnh_back' | 'cnh_full'
  | 'rg_front' | 'rg_back' | 'cpf'
  | 'income_proof' | 'unknown';
export function classifyDocument(ocrText: string): LeadDocumentType;

// apps/bot/src/flows/lead/checklist.ts
export interface ChecklistStatus {
  name: boolean;
  income: boolean;
  identity: { complete: boolean; have: LeadDocumentType[]; missing: string[] };
  residents: { complete: boolean; expected: number | null; collected: number };
  complete: boolean;
}
export function buildChecklist(input: ChecklistInput): ChecklistStatus;
export function renderChecklistText(status: ChecklistStatus): string;
export async function getChecklistForLead(leadId: string): Promise<ChecklistStatus>;

// apps/bot/src/flows/lead/escalation.ts
export async function escalateToHuman(
  chatId: string,
  ownerId: string,
  leadName: string | null,
  reason: 'human_request' | 'frustration' | 'loop' | 'contestation',
): Promise<void>;
```
