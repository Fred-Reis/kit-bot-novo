# Workflow — kit-manager

> Pipeline padrão pra implementar cada slice do [ROADMAP.md](./ROADMAP.md).
> Cada step = sessão isolada, skill específica, artefato em arquivo separado.
> Commits sob seu controle.

---

## Pipeline

```
Slice escolhida (ROADMAP.md)
    │
    ▼
1. /spec        → specs/<slice>.md           (o quê + porquê)
    │
    ▼
2. /plan        → tasks/<slice>-plan.md      (passo a passo)
    │
    ▼
3. /build       → código (task a task)       (aprovação manual)
    │
    ▼
4. /simplify    → diff enxuto                (sem mudar comportamento)
    │
    ▼
5. /review      → análise 5 eixos            (blocker/major/minor/nit)
    │
    ▼
6. COMMIT (você)
```

Cada step pode parar e retomar em outra sessão. Não precisa fazer tudo no mesmo ciclo.

---

## 1️⃣ SPEC

**Skill:** `/spec` (alias `agent-skills:spec` / `spec-driven-development`)
**Entrada:** nome do slice (do ROADMAP)
**Saída:** `specs/<slice>.md`

### Prompt

```
/spec

Slice: <nome do slice no ROADMAP>

Contexto obrigatório a consumir:
- PRD.md (produto)
- BRAINSTORM.md (decisões B1–B14)
- ROADMAP.md (escopo do slice)
- CLAUDE.md (restrições)
- OVERVIEW.md (arquitetura atual)
- specs/ existentes (consistência)

Crie specs/<slice>.md com seções:
- Objetivo (1–2 linhas)
- Escopo (in/out — explícito)
- Schema changes (migrations Prisma SQL)
- Tipos compartilhados (packages/types)
- Bot changes (endpoints, services, flow)
- Web changes (queries, rotas, componentes)
- Activity log keys (ver convenção em BRAINSTORM §5 C3)
- Notificações (canais e gatilhos)
- Critérios de aceite (testáveis, marcáveis com [x])
- Riscos / edge cases

Interview-me até 95% de confiança antes de finalizar.
NÃO escreva código. SÓ o spec.
```

### Critério de pronto
- Arquivo `specs/<slice>.md` criado e revisado por você
- Critérios de aceite acionáveis
- Sem ambiguidade de escopo

---

## 2️⃣ PLAN

**Skill:** `/plan` (alias `agent-skills:plan` / `planning-and-task-breakdown`)
**Entrada:** `specs/<slice>.md`
**Saída:** `tasks/<slice>-plan.md`

### Prompt

```
/plan

Spec: specs/<slice>.md

Crie tasks/<slice>-plan.md:
- Tarefas granulares (1 task ≈ 1 commit atômico lógico)
- Tom imperativo ("Adicionar coluna X em Lead", "Atualizar tipo Y")
- Ordem por dependência: schema → types → backend → frontend → integrações
- Cada task contém:
  - ID curto (T01, T02, ...)
  - Arquivos afetados
  - Comando de verificação (bunx tsc --noEmit, bunx oxlint, etc)
  - Critério de pronto

Só planeje o que tem certeza. Em dúvida, pergunte antes.
SEMPRE siga regras e padrões do projeto.

NÃO escreva código. SÓ o plano.
```

### Critério de pronto
- Arquivo `tasks/<slice>-plan.md` criado e revisado
- Cada task executável isoladamente
- Ordem respeitada (sem dependências para trás)

---

## 3️⃣ BUILD

**Skill:** `/build` (alias `agent-skills:build` / `incremental-implementation`)
**Entrada:** `tasks/<slice>-plan.md`
**Saída:** código + diff verificável

### Prompt

```
/build

Plan: tasks/<slice>-plan.md

Execute task por task:
- UMA task por vez. Aprovação manual antes de cada.
- Estritamente CLAUDE.md, oxlint, padrão de componentes (.claude/skills/create-component/)
- NÃO toque em código fora do escopo da slice
- SEM overengineering — solução simples e direta
- Em dúvida, pergunte antes de implementar
- Use skills apropriadas que estiverem disponíveis (create-component, etc)

Após cada task implementada:
1. Rode `bunx tsc --noEmit` no app afetado
2. Rode `bunx oxlint` no app afetado
3. Confirme verde antes de marcar task concluída
4. Aguarde minha autorização pra próxima

NUNCA siga adiante sem minha estrita autorização.
```

### Critério de pronto
- Todas as tasks do plano marcadas [x]
- TypeCheck verde em ambos apps afetados
- Oxlint sem warnings novos
- Sem regressões nas demais features (smoke test manual)

---

## 4️⃣ SIMPLIFY

**Skill:** `/simplify` (alias `agent-skills:code-simplify`)
**Entrada:** diff da slice (HEAD vs base do branch)
**Saída:** diff enxuto, comportamento preservado

### Prompt

```
/simplify

Diff: branch atual vs main.
Escopo: APENAS arquivos modificados pela slice.

Procure e elimine:
- Duplicação de código eliminável
- Abstrações que não pagam o custo
- Testes que não cobrem nada relevante
- Complexidade gratuita / overengineering
- Comentários óbvios ou redundantes
- Imports não usados
- Console.log e TODOs órfãos

Restrições:
- NÃO saia do escopo da slice
- NÃO viole convenções (CLAUDE.md, padrão de componentes)
- NÃO mude comportamento — só forma
- Em dúvida sobre uma simplificação, pergunte antes

Após mudanças: tsc + oxlint verde.
```

### Critério de pronto
- Diff revisado e enxuto
- Sem regressões
- TypeCheck + lint verde

---

## 5️⃣ REVIEW

**Skill:** `/review` (alias `code-review` / `code-review-and-quality`)
**Entrada:** diff da slice
**Saída:** issues categorizados

### Prompt

```
/review

Diff: branch atual vs main.
Atue como staff engineer rigoroso.

Análise 5 eixos:
1. Correctness — atende os critérios de aceite em specs/<slice>.md?
2. Readability — nomes claros, estrutura coerente, sem código denso desnecessário
3. Architecture — segue padrões existentes? Adiciona dívida desnecessária?
4. Security — secrets, validação, RLS, OWASP top 10 aplicável
5. Performance — queries N+1, re-renders, cache, payload size

Checks obrigatórios:
- oxlint sem warnings novos
- bunx tsc --noEmit verde
- Padrão de componentes (.claude/skills/create-component/)
- Cobertura de testes onde aplicável
- Nenhuma regressão introduzida
- Activity log emitido onde necessário (ver spec)
- Notificações disparadas onde necessário (ver spec)

Output:
- Issues categorizados: 🔴 blocker · 🟠 major · 🟡 minor · 🔵 nit
- Para cada issue: arquivo:linha, descrição, sugestão concreta
- Veredito final: APPROVE | REQUEST_CHANGES | COMMENT

Foco APENAS no escopo da slice.
```

### Critério de pronto
- Zero blockers
- Majors resolvidos ou justificados
- Veredito `APPROVE`

---

## 6️⃣ COMMIT

**Skill:** nenhuma. Você comita.

Memória persistente: você gerencia git. Claude não roda commit/push.

### Padrão de mensagem de commit

```
<scope>: <ação> <objeto>

[corpo opcional explicando o porquê]

Slice: <nome>
Spec: specs/<slice>.md
```

Exemplos:
```
leads: adicionar campo source detectado pelo extrator LLM
properties: migrar Property.area como float NOT NULL
foundation: criar ActivityLog table + helpers
```

### O que Claude faz
- Resumo do diff (`git diff --stat`)
- Highlights das mudanças por arquivo
- Sugestão de mensagem (se você pedir)

### O que Claude NÃO faz
- `git add`, `git commit`, `git push`, `git rebase`
- Nada destrutivo no histórico

---

## Convenções do fluxo

### Branch por slice
- Nome: `slice-N-<nome>` (ex: `slice-1-leads`, `slice-2-properties`)
- Base: `main`
- Após review APPROVE: merge na main (você decide squash/rebase/merge)

### Imutabilidade
- Spec aprovado: imutável até fim do slice. Mudança = volta pro /spec
- Plan aprovado: imutável até fim do slice. Mudança = volta pro /plan
- BRAINSTORM/ROADMAP: editáveis sempre, mas atualizar após cada slice

### Verificação automática após código
- `bunx tsc --noEmit` em ambos apps
- `bunx oxlint` em ambos apps
- Sem warnings novos vs main

### Quando pausar

- Skill SPEC: você precisa pensar no requisito → pause após `/spec`
- Skill PLAN: você precisa validar abordagem → pause após `/plan`
- Skill BUILD: aprovação manual a cada task — pausas naturais
- Skill SIMPLIFY: você precisa decidir trade-off → pause se Claude perguntar
- Skill REVIEW: pode iterar — volte ao `/build` se houver blocker

### Quando voltar pra etapa anterior
- BUILD descobre lacuna no plan → volta pro `/plan`
- PLAN descobre ambiguidade no spec → volta pro `/spec`
- REVIEW pede mudança grande → pode voltar pro `/build` ou até `/spec`

---

## Files mantidos pelo fluxo

| Arquivo | Quem escreve | Quando atualizar |
|---|---|---|
| `specs/<slice>.md` | Claude (via /spec) | Início do slice |
| `tasks/<slice>-plan.md` | Claude (via /plan) | Após spec aprovado |
| `<código>` | Claude (via /build) | Task por task |
| `BRAINSTORM.md` | Claude (manual) | Quando decisão nova/imutável surge |
| `ROADMAP.md` | Claude (manual) | Ao marcar slice completa |
| `adrs/NNN-titulo.md` | Claude (manual) | Decisões arquiteturais grandes |
| `OVERVIEW.md` | Claude (manual) | Após mudanças estruturais |
| Commits | Você | Após cada task ou ao fim do slice |

---

## Quick resume (nova sessão / após /clear)

Cole exatamente isso ao iniciar uma sessão nova:

```text
Lê: workflow.md, ROADMAP.md, CLAUDE.md, OVERVIEW.md

Retomando o pipeline. Oriente-se:
1. No ROADMAP.md: veja o que está [x] e o que está [ ] — identifique a slice atual ou próxima
2. No workflow.md: pipeline é /spec → /plan → /build → /simplify → /review → COMMIT
3. Se existir specs/<slice>.md: verifique se tem TODAS as seções obrigatórias (Objetivo, Escopo in/out, Schema changes, Tipos, Bot changes, Web changes, Activity log keys, Notificações, Critérios de aceite, Riscos). Se faltar qualquer seção → spec incompleto → próximo step é /spec, não /plan
4. Se spec completo e tasks/<slice>-plan.md não existe → próximo step é /plan
5. Se tasks/<slice>-plan.md existe → próximo step é /build
6. Se código foi escrito mas sem /simplify ou /review → execute na ordem

Regras invioláveis (sempre):
- NUNCA siga adiante sem minha estrita autorização
- NUNCA rode git commit, git push ou qualquer comando git destrutivo
- Uma task por vez, aprovação manual antes de cada

Me diga em qual step estamos e o que vem a seguir. Aguarde minha confirmação antes de agir.
```

---

## Quick start

Pra começar uma slice:

```bash
# 1. Criar branch
git checkout -b slice-N-<nome>

# 2. Iniciar Claude e rodar:
/spec
# (Claude pergunta detalhes, escreve specs/<slice>.md)

# 3. Validar specs/<slice>.md — você revisa, ajusta

# 4. Próximo:
/plan
# (Claude lê spec, escreve tasks/<slice>-plan.md)

# 5. Validar tasks/<slice>-plan.md

# 6. Implementar:
/build
# (Claude executa task por task com aprovação)

# 7. Após buildar tudo:
/simplify

# 8. Após simplificar:
/review

# 9. Após APPROVE:
git add ...
git commit -m "..."
git push
```

---

## Skill mapping (referência)

| Step | Slash command | Skill name (caso `/cmd` não esteja disponível) |
|---|---|---|
| 1 | `/spec` | `spec-driven-development` |
| 2 | `/plan` | `planning-and-task-breakdown` |
| 3 | `/build` | `incremental-implementation` |
| 4 | `/simplify` | `code-simplification` |
| 5 | `/review` | `code-review-and-quality` |

Outras skills úteis fora do pipeline:
- `/verify` — verificar mudança em runtime real (browser/CLI/API)
- `/test` — TDD ou Prove-It pra bugs
- `/ship` — pré-deploy checklist
- `/run` — subir app pra screenshot/teste manual

---

## Referências

- Produto: [PRD.md](./PRD.md)
- Sequência: [ROADMAP.md](./ROADMAP.md)
- Decisões: [BRAINSTORM.md](./BRAINSTORM.md)
- Restrições: [CLAUDE.md](./CLAUDE.md)
- Arquitetura: [OVERVIEW.md](./OVERVIEW.md)
