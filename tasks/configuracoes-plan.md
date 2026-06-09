# Plan — Slice 9: Configurações

> Spec: `specs/configuracoes.md`
> Escopo: apenas `apps/web`. Sem migrations, sem endpoints de bot.

---

## Grafo de dependências

```
T01 (ui.ts — persist + notificações)
        ↓               ↓
T02 (__root.tsx)   T03 (config/index.tsx)
  dark mode sync     aparência + notif + nav
```

T01 é pré-requisito de T02 e T03. T02 e T03 são independentes entre si.

---

## Tasks

### T01 — Adicionar `persist` + campos de notificações ao `ui.ts` store

**Arquivo:** `apps/web/src/store/ui.ts`

**O que fazer:**

1. Importar `persist` de `zustand/middleware`
2. Envolver o store em `persist(...)` com `name: 'kit-manager-ui'`
3. Adicionar dois campos ao estado:
   - `notificationsEnabled: boolean` — default `true`
   - `autoRefresh: boolean` — default `true`
4. Adicionar dois setters:
   - `setNotificationsEnabled: (v: boolean) => void`
   - `setAutoRefresh: (v: boolean) => void`
5. Manter os campos e setters existentes (`sidebarCollapsed`, `darkMode`, etc.) sem alteração de comportamento

Store resultante:

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

**Verificação:**
```bash
cd apps/web && bunx tsc --noEmit
cd apps/web && bunx oxlint src/store/ui.ts
```

**Critério de pronto:**
- `useUiStore` exporta `notificationsEnabled`, `autoRefresh` e respectivos setters
- Store usa `persist` middleware com `name: 'kit-manager-ui'`
- TypeCheck e oxlint verdes
- Nenhum consumer existente do store quebrado (verificar via TypeCheck)

---

### T02 — Sincronizar dark mode na hidratação em `__root.tsx`

**Arquivo:** `apps/web/src/routes/__root.tsx`

**Por quê:** `persist` hidrata o estado de forma assíncrona após o mount. O `setDarkMode` no store aplica o `dataset.dark` apenas quando chamado explicitamente — não na hidratação. Sem o `useEffect` abaixo, há flash de tema claro no reload mesmo com dark mode ativado.

**O que fazer:**

1. Importar `useUiStore` de `@/store/ui`
2. Em `RootComponent`, adicionar leitura do `darkMode` e `useEffect` de sync:

```tsx
function RootComponent() {
  const setSession = useAuthStore((s) => s.setSession);
  const darkMode = useUiStore((s) => s.darkMode);

  useEffect(() => {
    document.documentElement.dataset.dark = darkMode ? 'true' : '';
  }, [darkMode]);

  useEffect(() => {
    // ... auth listener existente (não tocar)
  }, [setSession]);

  return ( /* ... sem mudança */ );
}
```

**Verificação:**
```bash
cd apps/web && bunx tsc --noEmit
cd apps/web && bunx oxlint src/routes/__root.tsx
```

**Critério de pronto:**
- `useEffect` com dependência `[darkMode]` presente em `RootComponent`
- `useUiStore` importado
- TypeCheck e oxlint verdes

---

### T03 — Atualizar `config/index.tsx`: aparência + notificações + nav buttons

**Arquivo:** `apps/web/src/routes/_dashboard/config/index.tsx`

**O que fazer — 3 sub-mudanças:**

#### 3a. Aparência — remover seletor de idioma

Substituir `AppearanceSection` removendo o `useState('pt-BR')`, o `<Select>` e a `SettingRow` de idioma. Manter apenas o toggle de dark mode:

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

Remover o import de `Select` se não for mais usado em nenhum outro lugar do arquivo.

#### 3b. Notificações — usar Zustand

Substituir o `useState` local por campos do store:

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

#### 3c. Nav buttons — data-[active] + twMerge

Substituir o template literal condicional pelo padrão de data-attribute:

```tsx
// Adicionar import no topo (se não existir):
import { twMerge } from 'tailwind-merge';

// Substituir o <button> no map:
<button
  key={item.id}
  type="button"
  data-active={active === item.id ? '' : undefined}
  onClick={() => setActive(item.id)}
  className={twMerge(
    'w-full rounded-[7px] px-3 py-2 text-left text-sm transition-colors',
    'text-muted-foreground hover:text-foreground hover:bg-muted/50',
    'data-[active]:bg-accent-soft data-[active]:text-accent-ink data-[active]:font-medium'
  )}
>
  {item.label}
</button>
```

**Verificação:**
```bash
cd apps/web && bunx tsc --noEmit
cd apps/web && bunx oxlint src/routes/_dashboard/config/index.tsx
```

**Critério de pronto:**
- `AppearanceSection` sem seletor de idioma e sem `useState` de language
- `NotificationsSection` usa `useUiStore` (sem `useState` local)
- Nav buttons usam `data-active` + `twMerge` — sem template literal condicional
- Import de `Select` removido se não usado
- TypeCheck e oxlint verdes

---

## Checkpoint final

Após T01 + T02 + T03:

```bash
cd apps/web && bunx tsc --noEmit   # zero erros
cd apps/web && bunx oxlint src/    # zero warnings novos
```

Verificar manualmente:
- Ativar dark mode → recarregar página → dark mode permanece ativo
- Desativar "Notificações ativas" → recarregar → toggle permanece desativado
- `localStorage['kit-manager-ui']` contém `darkMode`, `notificationsEnabled`, `autoRefresh`
- Nav de configurações: item ativo tem fundo laranja, inativo tem texto muted
- Aparência exibe apenas o toggle de dark mode (sem seletor de idioma)
