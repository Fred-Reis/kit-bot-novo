# Design: Polish, Bugfixes e Property Detail Completion

**Data:** 2026-06-09
**Slices:** slice-10-bugfixes · slice-11-property-detail

---

## Contexto

Varredura de itens pendentes antes de Fase 2. Foram encontrados 3 bugs reais (B1–B3), 3 tabs vazias sem conteúdo definido (C1, C4, C5) e 2 features de property detail não implementadas (C2, C3).

---

## slice-10-bugfixes

### Objetivo

Remover tabs sem conteúdo definido, corrigir o login Google e adicionar guardrails ao fluxo de contrato.

### Remoções de tabs

**Property detail — aba "Documentos" (C1):**

- Remover `'documents'` de `TABS` em `$propertyId/index.tsx`
- Remover branch `tab === 'documents'` do render
- Adicionar ao ROADMAP como item futuro sem design

**Rules — tabs "Blocos reutilizáveis", "Templates completos", "Campos estruturados" (C4):**

- Remover itens 1–3 de `TABS` em `rules/index.tsx` — manter apenas "Políticas"
- Remover a barra de navegação de tabs (sem sentido com uma única tab)
- Adicionar ao ROADMAP como item futuro sem design

**Finance — aba "Relatórios" (C5):**

- Remover `'Relatórios'` de `TABS` em `finance/index.tsx`
- Remover branch `tab === 4` do render
- Adicionar ao ROADMAP como item futuro sem design

### B1 — Google OAuth não funciona

**Causa:** Configuração ausente no Supabase Console — Google provider desabilitado e/ou URL de redirect não whitelisted. O código (`signInWithOAuth`) está correto.

**Fix de código:**

- Adicionar `try/catch` em `handleGoogle` em `login.tsx`
- `toast.error('Erro ao iniciar login com Google.')` em caso de falha
- Hoje falha silenciosamente

**Documentação:**

- Criar `docs/supabase-oauth-setup.md` com passos: ativar Google provider no Supabase Console, adicionar Client ID/Secret, whitelist de redirect URLs (`http://localhost:5173`, URL de produção)

### B2 — "Marcar contrato assinado" quebra sem feedback útil

**Causa real:** O endpoint `generate-contract` apenas avança o stage — não cria um `Contract` record. `Contract` não tem `leadId`, então não há como checar existência de contrato via lead. A quebra com dados de seed é um erro opaco porque: (a) o bot pode não estar rodando em dev, e/ou (b) o `toast.error` ignora o corpo da resposta de erro da API.

**Fix:**

- Em `$leadId.tsx`: propagar o erro da API no `toast.error` — hoje mostra mensagem genérica independente do status code
- Extrair `error.message` da resposta do bot quando disponível: `toast.error(apiError.message ?? 'Erro ao marcar contrato.')`
- Aplicar o mesmo padrão em `approveKyc`, `confirmPayment` e `generateContract` — todos com `toast.error` genérico hoje

### B3 — "Gerar Contrato" sem template publicado

**Causa:** Botão em `residents_docs_complete` não valida se existe template publicado antes de abrir o modal.

**Fix:**

- Em `GenerateContractModal`, ao montar: buscar templates publicados via `fetchContractTemplates({ status: 'published' })`
- Se lista vazia: renderizar estado de erro inline "Nenhum template publicado. Crie um em Templates antes de continuar." com botão "Ir para Templates" → `/templates`
- Campos do modal ficam ocultos nesse estado

### ROADMAP updates (slice-10)

Adicionar em seção "Backlog de features sem design":

- `[ ]` Property detail — aba Documentos do imóvel (escritura, IPTU, matrícula)
- `[ ]` Rules — Blocos reutilizáveis (cláusulas reutilizáveis)
- `[ ]` Rules — Templates completos
- `[ ]` Rules — Campos estruturados
- `[ ]` Finance — Relatórios exportáveis

---

## slice-11-property-detail

### Objetivo

Completar o detalhe do imóvel com aba Histórico funcional e sidebar de inquilino atual.

### C2 — Aba Histórico

**Query:** `ActivityLog` onde `subjectId = propertyId`, ordenado por `createdAt DESC`, limit 20.

**UI:**

- Lista de itens com: ator (`actorLabel`), ação via `ACTIVITY_LABELS`, tempo relativo
- Mesmo padrão visual do activity feed do Dashboard
- Estado vazio: "Nenhuma atividade registrada."
- Sem paginação — 20 mais recentes suficientes para MVP

Sem schema changes — `ActivityLog.subjectId` já existe.

### C3 — Sidebar Inquilino

**Query:** `Tenant` onde `propertyId = propertyId` (FK já existe no schema).

**UI:**

- Se tenant existe: nome, telefone, status pill (Em dia / Atenção / Inadimplente — mesma lógica de `onTimeRate` já usada na lista de tenants) + link `→ /tenants/:id`
- Se não existe: manter "Sem inquilino." como está
- Sidebar read-only — sem mutations

Sem schema changes.

---

## Critérios de aceite

### slice-10

- [ ] Tabs removidas: Documentos (property), Blocos/Templates/Campos (rules), Relatórios (finance)
- [ ] ROADMAP atualizado com itens removidos como backlog futuro
- [ ] Google login: `try/catch` + `toast.error` em caso de falha
- [ ] `docs/supabase-oauth-setup.md` criado
- [ ] Erros da API propagados com mensagem real em todas as mutações do lead detail
- [ ] Modal "Gerar Contrato" mostra erro quando sem template publicado

### slice-11

- [ ] Aba Histórico exibe ActivityLog do imóvel (últimos 20)
- [ ] Estado vazio correto no Histórico
- [ ] Sidebar mostra inquilino atual com nome, status e link
- [ ] Sidebar mostra "Sem inquilino." quando não há tenant
- [ ] `bunx tsc --noEmit` verde em ambos os apps
- [ ] `bunx oxlint` sem warnings novos

---

## Fora de escopo

- Paginação do Histórico
- Mutations na sidebar do imóvel
- Conteúdo das tabs removidas (backlog futuro)
- Google OAuth funcionando end-to-end (depende de config do Supabase Console pelo owner)
- Outros itens S1–S10 (já no ROADMAP)
