# slice-10-bugfixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remover tabs sem conteúdo, corrigir falha silenciosa no Google OAuth e melhorar feedback de erros no fluxo de contratos.

**Architecture:** Mudanças puramente no `apps/web`. Nenhuma alteração de schema ou bot. Três grupos: (1) remoção de tabs, (2) login fix, (3) guardrails de contrato.

**Tech Stack:** React 19, TanStack Query, Supabase JS, Axios, Sonner (toasts), Vite + Bun

---

## Arquivos modificados

| Arquivo | O que muda |
|---|---|
| `apps/web/src/routes/_dashboard/properties/$propertyId/index.tsx` | Remove tab `documents` |
| `apps/web/src/routes/_dashboard/rules/index.tsx` | Remove tabs 1–3, remove barra de tabs |
| `apps/web/src/routes/_dashboard/finance/index.tsx` | Remove tab `Relatórios` |
| `ROADMAP.md` | Adiciona itens removidos como backlog futuro |
| `apps/web/src/routes/_auth/login.tsx` | Adiciona `try/catch` no `handleGoogle` |
| `docs/supabase-oauth-setup.md` | Novo — guia de configuração do Google OAuth |
| `apps/web/src/routes/_dashboard/leads/$leadId.tsx` | Propaga mensagem real de erro nas mutações, adiciona guard de template |
| `apps/web/src/lib/queries.ts` | Adiciona `fetchPublishedTemplates` |

---

## T01 — Remover aba "Documentos" do detalhe do imóvel

**Arquivo:** `apps/web/src/routes/_dashboard/properties/$propertyId/index.tsx`

- [x] Localizar linha 18: `type Tab = 'details' | 'rules' | 'gallery' | 'documents' | 'history';`

  Substituir por:

  ```typescript
  type Tab = 'details' | 'rules' | 'gallery' | 'history';
  ```

- [x] Localizar o array `TABS` (linha 20–26). Substituir por:

  ```typescript
  const TABS: { id: Tab; label: string }[] = [
    { id: 'details', label: 'Detalhes' },
    { id: 'rules', label: 'Regras' },
    { id: 'gallery', label: 'Galeria' },
    { id: 'history', label: 'Histórico' },
  ];
  ```

- [x] Localizar o bloco de render condicional que contém `tab === 'documents'` (linha 260):

  ```typescript
  {(tab === 'documents' || tab === 'history') && (
  ```

  Substituir por:

  ```typescript
  {tab === 'history' && (
  ```

- [x] Rodar `cd apps/web && bunx tsc --noEmit` — deve estar verde

---

## T02 — Remover tabs 1–3 e nav de tabs em Regras

**Arquivo:** `apps/web/src/routes/_dashboard/rules/index.tsx`

- [x] Remover a constante `TABS` da linha 15:

  ```typescript
  const TABS = ['Políticas', 'Blocos reutilizáveis', 'Templates completos', 'Campos estruturados'];
  ```

- [x] Remover o state de tab. Localizar:

  ```typescript
  const [tab, setTab] = useState(0);
  ```

  Remover essa linha.

- [x] Localizar o bloco de renderização das tabs (buscar por `{TABS.map`). Remover o bloco inteiro da barra de tabs — do elemento pai que contém `TABS.map` até o fechamento dele.

- [x] Localizar o condicional `{tab === 0 ? (`. O conteúdo verdadeiro (a seção de políticas) deve ser mantido. Substituir o ternário `{tab === 0 ? (<conteudo>) : (<placeholder Em construção>)}` por apenas `{<conteudo>}`, sem o wrapper condicional.

- [x] Remover o import de `useState` se não for mais usado em outro lugar no arquivo (checar).

- [x] Rodar `cd apps/web && bunx tsc --noEmit` — deve estar verde

---

## T03 — Remover aba "Relatórios" do Financeiro

**Arquivo:** `apps/web/src/routes/_dashboard/finance/index.tsx`

- [x] Localizar a linha 20:

  ```typescript
  const TABS = ['Visão geral', 'Receitas', 'À receber', 'Repasses', 'Relatórios'];
  ```

  Substituir por:

  ```typescript
  const TABS = ['Visão geral', 'Receitas', 'À receber', 'Repasses'];
  ```

- [x] Localizar o bloco de render `{tab === 4 && <Placeholder text="Em construção." />}` e removê-lo.

- [x] Verificar se `Placeholder` ainda é usado em outro lugar no arquivo. Se `tab === 3` com `Placeholder text="Disponível com multi-tenancy."` ainda existir, manter. Se `Placeholder` ficou sem uso, remover a função também.

- [x] Rodar `cd apps/web && bunx tsc --noEmit && bunx oxlint src/` — deve estar verde

---

## T04 — Atualizar ROADMAP.md com backlog dos itens removidos

**Arquivo:** `ROADMAP.md`

- [x] Localizar a seção `## Fase 3 — Dogfooding`. Adicionar uma nova seção **antes** dela:

  ```markdown
  ## Backlog de features sem design

  > Features removidas da UI por não terem design ou backend definidos. Retomar quando houver spec.

  - [ ] Property detail — aba Documentos do imóvel (escritura, IPTU, matrícula)
  - [ ] Rules — aba Blocos reutilizáveis (cláusulas de contrato reutilizáveis)
  - [ ] Rules — aba Templates completos
  - [ ] Rules — aba Campos estruturados
  - [ ] Finance — aba Relatórios exportáveis
  ```

---

## T05 — Adicionar try/catch no Google OAuth

**Arquivo:** `apps/web/src/routes/_auth/login.tsx`

- [x] Adicionar import de `toast` no topo do arquivo (se ainda não importado):

  ```typescript
  import { toast } from 'sonner';
  ```

- [x] Substituir o `handleGoogle` atual:

  ```typescript
  async function handleGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  }
  ```

  Por:

  ```typescript
  async function handleGoogle() {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) toast.error('Erro ao iniciar login com Google.');
    } catch {
      toast.error('Erro ao iniciar login com Google.');
    }
  }
  ```

- [x] Rodar `cd apps/web && bunx tsc --noEmit` — verde

---

## T06 — Criar guia de configuração do Google OAuth

**Arquivo:** `docs/supabase-oauth-setup.md` (novo)

- [x] Criar o arquivo com o conteúdo:

  ```markdown
  # Configurar Google OAuth no Supabase

  ## Pré-requisitos

  - Conta Google Cloud com projeto criado
  - Acesso ao Supabase Console do projeto

  ## Passos

  ### 1. Google Cloud Console

  1. Acesse https://console.cloud.google.com e selecione seu projeto
  2. Vá em **APIs & Services → Credentials**
  3. Clique em **Create Credentials → OAuth 2.0 Client ID**
  4. Tipo: **Web application**
  5. Em **Authorized redirect URIs**, adicione:
     - `https://<seu-projeto>.supabase.co/auth/v1/callback`
  6. Copie o **Client ID** e **Client Secret**

  ### 2. Supabase Console

  1. Acesse https://supabase.com/dashboard e abra o projeto
  2. Vá em **Authentication → Providers**
  3. Habilite **Google**
  4. Cole o **Client ID** e **Client Secret** obtidos acima
  5. Salve

  ### 3. Redirect URLs permitidas

  No Supabase Console, em **Authentication → URL Configuration**:

  - **Site URL**: URL de produção (ex: `https://kit-manager.vercel.app`)
  - **Redirect URLs**: adicionar cada ambiente:
    - `http://localhost:5173`
    - `https://kit-manager.vercel.app`

  ## Verificar

  Com as configurações acima, o botão "Entrar com Google" em `/login` deve abrir
  o fluxo OAuth do Google e redirecionar de volta ao painel após autenticação.
  ```

---

## T07 — Propagar erros reais da API no lead detail

**Arquivo:** `apps/web/src/routes/_dashboard/leads/$leadId.tsx`

Os quatro `useMutation` (`togglePause`, `approveKyc`, `confirmPayment`, `markSigned`) usam `toast.error` com mensagem hardcoded que ignora o erro real. O fix é criar um helper e aplicar em todos.

- [x] Adicionar import de `axios` no topo do arquivo:

  ```typescript
  import axios from 'axios';
  ```

- [x] Adicionar a função helper logo após os imports (antes de `export const Route`):

  ```typescript
  function apiErrorMessage(err: unknown, fallback: string): string {
    if (axios.isAxiosError(err)) {
      const msg = (err.response?.data as { error?: string } | undefined)?.error;
      if (msg) return msg;
    }
    return fallback;
  }
  ```

- [x] Atualizar o `onError` dos quatro mutations:

  ```typescript
  // togglePause
  onError: (err) => toast.error(apiErrorMessage(err, 'Erro ao alternar bot.')),

  // approveKyc
  onError: (err) => toast.error(apiErrorMessage(err, 'Erro ao aprovar KYC.')),

  // confirmPayment
  onError: (err) => toast.error(apiErrorMessage(err, 'Erro ao confirmar pagamento.')),

  // markSigned
  onError: (err) => toast.error(apiErrorMessage(err, 'Erro ao marcar contrato.')),
  ```

- [x] Rodar `cd apps/web && bunx tsc --noEmit` — verde

---

## T08 — Guard de template publicado no modal de Gerar Contrato

**Arquivo:** `apps/web/src/lib/queries.ts`

- [x] Adicionar a função `fetchPublishedTemplates` ao final de `queries.ts`:

  ```typescript
  export async function fetchPublishedTemplates(): Promise<ContractTemplateSummary[]> {
    const { data, error } = await supabase
      .from('ContractTemplate')
      .select('id, code, name, status, updatedAt, contracts:Contract(count)')
      .eq('status', 'published')
      .order('updatedAt', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((t) => {
      const { contracts, ...rest } = t as typeof t & { contracts: { count: number }[] };
      return { ...rest, usageCount: contracts[0]?.count ?? 0 };
    }) as ContractTemplateSummary[];
  }
  ```

**Arquivo:** `apps/web/src/routes/_dashboard/leads/$leadId.tsx`

- [x] Adicionar import no topo:

  ```typescript
  import { Link } from '@tanstack/react-router';
  import { fetchPublishedTemplates } from '@/lib/queries';
  ```

  Nota: `Link` pode já estar importado — checar antes de duplicar.

- [x] Adicionar query de templates dentro de `GenerateContractModal`:

  ```typescript
  function GenerateContractModal({ leadId, onClose }: { leadId: string; onClose: () => void }) {
    const [day, setDay] = useState(10);
    const qc = useQueryClient();

    const { data: templates = [], isLoading: loadingTemplates } = useQuery({
      queryKey: ['published-templates'],
      queryFn: fetchPublishedTemplates,
    });

    const hasTemplates = templates.length > 0;

    const mutation = useMutation({
      mutationFn: () => adminApi.generateContract(leadId, Math.min(28, Math.max(1, day))),
      onSuccess: () => {
        toast.success('Contrato gerado.');
        void qc.invalidateQueries({ queryKey: ['lead', leadId] });
        onClose();
      },
      onError: (err) => toast.error(apiErrorMessage(err, 'Erro ao gerar contrato.')),
    });

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20">
        <div
          data-slot="modal"
          className="w-full max-w-sm rounded-xl border border-border bg-surface-raised p-6 shadow-lg"
        >
          <h2 className="text-base font-semibold text-foreground">Gerar Contrato</h2>

          {loadingTemplates ? (
            <p className="mt-3 text-sm text-muted-foreground">Verificando templates…</p>
          ) : !hasTemplates ? (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-destructive">
                Nenhum template publicado. Crie e publique um template antes de continuar.
              </p>
              <Link
                to="/templates"
                onClick={onClose}
                className="inline-flex items-center text-sm font-medium text-primary hover:underline"
              >
                Ir para Templates →
              </Link>
            </div>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted-foreground">Dia de vencimento do aluguel</p>
              <input
                type="number"
                min={1}
                max={28}
                value={day}
                onChange={(e) => setDay(Number(e.target.value))}
                className="mt-3 w-full rounded-lg border border-input bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <CustomButton variant="secondary" onClick={onClose}>
              Cancelar
            </CustomButton>
            {hasTemplates && !loadingTemplates && (
              <CustomButton
                variant="primary"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
              >
                {mutation.isPending ? 'Gerando...' : 'Gerar contrato'}
              </CustomButton>
            )}
          </div>
        </div>
      </div>
    );
  }
  ```

- [x] Rodar `cd apps/web && bunx tsc --noEmit` — verde

- [x] Rodar `cd apps/web && bunx oxlint src/` — sem warnings novos

---

## Verificação final

- [x] Abrir `/properties/:id` — confirmar que aba "Documentos" não aparece mais
- [x] Abrir `/rules` — confirmar que barra de tabs sumiu, apenas políticas visíveis
- [x] Abrir `/finance` — confirmar que aba "Relatórios" não aparece mais
- [x] Abrir `/login` — clicar "Entrar com Google" com bot offline — deve exibir `toast.error`
- [x] Abrir lead em `residents_docs_complete` — clicar "Gerar Contrato" sem template publicado — deve mostrar mensagem de erro + link
- [x] Abrir lead em `contract_pending` — clicar "Marcar contrato assinado" com bot offline — toast deve mostrar mensagem real do erro ou fallback legível
