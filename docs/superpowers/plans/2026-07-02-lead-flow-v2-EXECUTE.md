# Lead Flow v2 — Prompt de execução

> Colar o bloco abaixo numa sessão nova do Claude Code, aberta na raiz do repo.

```markdown
Execute a implementação do Lead Flow v2 deste repositório, do início ao fim,
seguindo os plans já escritos. Você é o orquestrador: dispara agentes, cobra
verificação e abre PRs — o merge é sempre meu.

## Fonte de verdade (leia nesta ordem, antes de qualquer código)
1. docs/superpowers/plans/2026-07-02-lead-flow-v2-README.md  ← coordenação: grafo de
   dependências, mapa de branches/PRs, contrato congelado A↔B, política de review
2. docs/superpowers/plans/2026-07-02-lead-flow-v2-fase-0-hotfix.md
3. docs/superpowers/plans/2026-07-02-lead-flow-v2-fase-a-doc-pipeline.md
4. docs/superpowers/plans/2026-07-02-lead-flow-v2-fase-b-agente-tools.md
Contexto de negócio (consulte se precisar): docs/lead-flow-v2.md (spec) e CLAUDE.md.
Os plans contêm código completo, testes e comandos por task — siga-os literalmente;
não redesenhe o que já está decidido.

## Ordem de execução
1. FASE 0 (sequencial, agora): worktree + branch feat/lead-flow-v2-fase-0 →
   executar as 5 tasks → PR 1.
2. CONTRATO (sequencial, agora): worktree + branch feat/lead-flow-v2-contract →
   Fase A tasks 2+3 → PR 2.
3. ⏸ CHECKPOINT: me apresente as URLs das PRs 1 e 2 e AGUARDE eu confirmar o merge.
4. PARALELO (após merge da PR 2): dois worktrees simultâneos —
   • feat/lead-flow-v2-fase-a: Fase A tasks 1, 4–10 → PR 3
   • feat/lead-flow-v2-fase-b: Fase B tasks 1–3 → PR 4 em DRAFT
5. ⏸ CHECKPOINT: aguarde merge da PR 3. Depois: rebase da fase-b, Fase B task 4,
   gh pr ready na PR 4.
6. NÃO execute a Fase B task 5 (cutover) — ela é gated por validação em produção.

## Ferramentas e método
- Worktrees: skill superpowers:using-git-worktrees (um por branch).
- Execução: skill superpowers:subagent-driven-development — agente novo por task,
  review entre tasks. Cada task só está completa com `bun test` e `bunx tsc --noEmit`
  verdes em apps/bot (rodar de verdade; não assumir).
- Code review: skill coderabbit:code-review no diff de cada branch ANTES do push
  (correções triviais: coderabbit:autofix). Fallback /code-review apenas se o
  CodeRabbit falhar — e me avise se usar o fallback. O app do CodeRabbit também
  revisa as PRs no GitHub: responda/resolva os apontamentos dele antes de me
  pedir merge.
- PRs: gh pr create conforme os steps dos plans (gh já autenticado).

## Regras invioláveis
- NUNCA commitar, pushar ou mergear em main. Merge é exclusivamente meu, via PR.
- Não alterar as assinaturas do contrato congelado (README §contrato) — se um plan
  parecer exigir isso, PARE e me pergunte.
- Escopo cirúrgico: só o que os plans pedem. Sem refactors extras, sem Python,
  sem npm/yarn (bun).
- Conflito entre plan e código real, teste que não passa como o plan previu,
  ou qualquer ambiguidade → PARE e me pergunte antes de improvisar.

## Ao final de cada fase, reporte
branch, PR (URL), tasks concluídas, resultado de bun test/tsc, findings de review
resolvidos e pendências para mim.
```
