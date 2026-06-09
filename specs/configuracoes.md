# Spec — Slice 9: Configurações

## Objetivo

Completar a página `/config` que já existe como scaffolding: remover o seletor de idioma, persistir os toggles de notificações e dark mode (hoje resetam no reload), e corrigir o padrão de active state no nav.

---

## Escopo

### In

- **Aparência** — remover seletor de idioma (PT-BR only), manter só o toggle dark mode
- **Dark mode** — adicionar persistência em localStorage via `zustand/middleware` `persist` no `ui.ts` store (hoje reseta no reload)
- **Notificações** — mover os dois toggles (`notifications`, `autoRefresh`) de `useState` ephemeral para Zustand com `persist` (localStorage), para que o estado sobreviva ao reload
- **Nav buttons** — substituir inline conditional className template literal por `twMerge` + `data-[active]` attribute pattern (seguir padrão de componentes)
- **TypeCheck + lint** verdes em `apps/web`

### Out

- Nenhuma migration de schema — sem colunas novas
- Nenhum endpoint novo no bot
- Integrações "Salvar" continua como toast "Em breve"
- Segurança "Alterar senha" continua como toast "Em breve"
- Equipe e Plano continuam como stubs
- Workspace continua hardcoded
- Realtime in-app notifications (badge no sidebar) → F0.4 separado
- Múltiplos idiomas / i18n — fora do MVP

---

## Schema changes

Nenhuma.

---

## Tipos compartilhados (`packages/types`)

Nenhuma alteração.

---

## Bot changes

Nenhuma.

---

## Web changes

### 1. `apps/web/src/store/ui.ts` — adicionar persist + notificações

Substituir o store atual por versão com `persist` middleware:

```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UiState {
  sidebarCollapsed: boolean;
  darkMode: boolean;
  notificationsEnabled: boolean;
  autoRefresh: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  setDarkMode: (v: boolean) => void;
  setNotificationsEnabled: (v: boolean) => void;
  setAutoRefresh: (v: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      darkMode: false,
      notificationsEnabled: true,
      autoRefresh: true,
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      setDarkMode: (v) => {
        document.documentElement.dataset.dark = v ? 'true' : '';
        set({ darkMode: v });
      },
      setNotificationsEnabled: (v) => set({ notificationsEnabled: v }),
      setAutoRefresh: (v) => set({ autoRefresh: v }),
    }),
    { name: 'kit-manager-ui' }
  )
);
```

**Atenção:** `persist` hidrata o estado após o mount. O `setDarkMode` side-effect (`dataset.dark`) não roda na hidratação — precisa de um `useEffect` no `__root.tsx` para sincronizar o `data-dark` com o valor hidratado do store.

### 2. `apps/web/src/routes/__root.tsx` — sync dark mode na hidratação

Adicionar `useEffect` que lê o `darkMode` do store e aplica ao `document.documentElement`:

```tsx
const { darkMode } = useUiStore();

useEffect(() => {
  document.documentElement.dataset.dark = darkMode ? 'true' : '';
}, [darkMode]);
```

Se esse `useEffect` já existir por outra razão, apenas confirmar que a dependência `darkMode` está incluída.

### 3. `apps/web/src/routes/_dashboard/config/index.tsx` — 3 mudanças

#### 3a. Aparência — remover seletor de idioma

Substituir `AppearanceSection` por:

```tsx
function AppearanceSection() {
  const { darkMode, setDarkMode } = useUiStore();
  return (
    <SectionCard title="Aparência" subtitle="Tema da interface.">
      <SettingRow label="Modo escuro">
        <Toggle checked={darkMode} onChange={setDarkMode} aria-label="Alternar modo escuro" />
      </SettingRow>
    </SectionCard>
  );
}
```

Remover o `useState('pt-BR')` e o `<Select>` de idioma.

#### 3b. Notificações — usar Zustand em vez de useState

```tsx
function NotificationsSection() {
  const { notificationsEnabled, setNotificationsEnabled, autoRefresh, setAutoRefresh } = useUiStore();
  return (
    <SectionCard title="Notificações" subtitle="Alertas e atualizações automáticas.">
      <SettingRow label="Notificações ativas">
        <Toggle checked={notificationsEnabled} onChange={setNotificationsEnabled} aria-label="Alternar notificações" />
      </SettingRow>
      <SettingRow label="Atualização automática">
        <Toggle checked={autoRefresh} onChange={setAutoRefresh} aria-label="Alternar atualização automática" />
      </SettingRow>
    </SectionCard>
  );
}
```

#### 3c. Nav buttons — padrão data-[active] + twMerge

Substituir o template literal condicional:

```tsx
// antes
className={`w-full ... ${active === item.id ? 'bg-accent-soft ...' : 'text-muted-foreground ...'}`}

// depois
<button
  key={item.id}
  type="button"
  data-active={active === item.id ? '' : undefined}
  onClick={() => setActive(item.id)}
  className={twMerge(
    'w-full rounded-[7px] px-3 py-2 text-left text-sm transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/50',
    'data-[active]:bg-accent-soft data-[active]:text-accent-ink data-[active]:font-medium'
  )}
>
  {item.label}
</button>
```

Adicionar import de `twMerge` se não existir.

---

## Activity log keys

Nenhuma. Configurações são UI state — não geram eventos de negócio.

---

## Notificações

Nenhuma.

---

## Critérios de aceite

- [ ] Aparência exibe apenas o toggle de dark mode — sem seletor de idioma
- [ ] Dark mode persiste após reload da página (ativar, recarregar, confirmar que continua ativo)
- [ ] `html[data-dark="true"]` está presente no DOM ao ativar dark mode, inclusive após reload
- [ ] Toggle "Notificações ativas" persiste após reload (ativar, recarregar, confirmar estado)
- [ ] Toggle "Atualização automática" persiste após reload
- [ ] LocalStorage tem chave `kit-manager-ui` com `darkMode`, `notificationsEnabled`, `autoRefresh`
- [ ] Nav buttons usam `data-[active]:` — sem conditional className via template literal
- [ ] Workspace exibe 6 campos somente leitura hardcoded
- [ ] Integrações: botão Salvar dispara `toast.info('Em breve')`
- [ ] Segurança: botão Alterar senha dispara `toast.info('Em breve')`
- [ ] Equipe: exibe mensagem stub "Disponível em breve"
- [ ] Plano: exibe mensagem stub "Em breve"
- [ ] `bunx tsc --noEmit` verde em `apps/web`
- [ ] `bunx oxlint src/` sem warnings novos em `apps/web`

---

## Riscos / edge cases

- **Hidratação do Zustand vs dark mode:** `persist` hidrata de forma assíncrona após o mount. Sem o `useEffect` no `__root.tsx`, há um flash de tema claro antes de aplicar o tema salvo. O `useEffect` corrige isso.
- **localStorage indisponível:** SSR / contexto sem browser — não aplicável (Vite SPA puro). Zustand `persist` tem fallback gracioso.
- **`sidebarCollapsed` já existia no store sem persist:** após migrar para `persist`, o valor de `sidebarCollapsed` também será persistido (não solicitado mas não prejudica). Aceitável.
- **Outros consumers de `useUiStore`:** verificar se algum componente usa `darkMode` ou `setDarkMode` diretamente e garantir que os novos campos (`notificationsEnabled`, `autoRefresh`) não quebrem o TypeScript nesses consumers.
