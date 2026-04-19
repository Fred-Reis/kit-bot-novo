---
name: create-component
description: >
  Creates React components for the kit-manager admin panel (apps/web).
  Use this skill whenever the user asks to create, build, scaffold, or write
  a React component, UI element, page, or widget in this project.
  Also triggers for: "add a [thing] component", "build the [thing] UI",
  "create a [thing] card/table/modal/form", "I need a [thing] screen".
---

# Create Component

When creating any React component for `apps/web`, follow this pattern exactly.
This file is the single source of truth for the component pattern.

## Stack

- **React 19** (sem `forwardRef`)
- **TypeScript** strict
- **Tailwind CSS v4** com `@theme` e CSS variables
- **shadcn/ui** (Radix UI por baixo) para primitivos headless
- **tailwind-variants** (`tv()`) para variantes
- **tailwind-merge** (`twMerge()`) para merge de classes
- **Lucide React** para ícones

**Shadcn MCP disponível:** https://ui.shadcn.com/docs/mcp — usar para consultar APIs e variantes dos componentes.

---

## Nomenclatura

- Arquivos: **lowercase com hífens** → `user-card.tsx`, `use-modal.ts`
- **Sempre named exports** — nunca `export default`
- Sem barrel files (`index.ts`) em pastas internas de componentes

---

## Estrutura Base — Componente com Variantes

```tsx
import { tv, type VariantProps } from 'tailwind-variants'
import { twMerge } from 'tailwind-merge'
import type { ComponentProps } from 'react'

export const buttonVariants = tv({
  base: [
    'inline-flex cursor-pointer items-center justify-center font-medium rounded-lg border transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  ],
  variants: {
    variant: {
      primary: 'border-primary bg-primary text-primary-foreground hover:bg-primary-hover',
      secondary: 'border-border bg-secondary text-secondary-foreground hover:bg-muted',
      ghost: 'border-transparent bg-transparent text-muted-foreground hover:text-foreground',
      destructive: 'border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90',
    },
    size: {
      sm: 'h-6 px-2 gap-1.5 text-xs [&_svg]:size-3',
      md: 'h-7 px-3 gap-2 text-sm [&_svg]:size-3.5',
      lg: 'h-9 px-4 gap-2.5 text-base [&_svg]:size-4',
    },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
})

export interface ButtonProps
  extends ComponentProps<'button'>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, disabled, children, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      data-slot="button"
      data-disabled={disabled ? '' : undefined}
      className={twMerge(buttonVariants({ variant, size }), className)}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  )
}
```

---

## Compound Components

```tsx
import { twMerge } from 'tailwind-merge'
import type { ComponentProps } from 'react'

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={twMerge('bg-surface flex flex-col gap-6 rounded-xl border border-border p-6 shadow-sm', className)}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-header" className={twMerge('flex flex-col gap-1.5', className)} {...props} />
}

export function CardTitle({ className, ...props }: ComponentProps<'h3'>) {
  return <h3 data-slot="card-title" className={twMerge('text-lg font-semibold', className)} {...props} />
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-content" className={className} {...props} />
}
```

---

## CSS Variables (cores)

```
bg-surface, bg-surface-raised       → fundos
bg-primary, bg-secondary, bg-muted  → ações/estados
bg-destructive                      → erros/danger

text-foreground                     → texto principal
text-foreground-subtle              → texto secundário
text-muted-foreground               → texto desabilitado
text-primary-foreground             → texto sobre bg-primary

border-border, border-input         → bordas padrão
border-primary, border-destructive  → bordas de destaque

ring-ring                           → focus ring
```

**Nunca usar cores hardcoded** (`bg-blue-500`). Sempre CSS variables.

---

## shadcn/ui (Radix) — Primitivos Headless

```tsx
// Dialog
import * as Dialog from '@/components/ui/dialog'
<Dialog.Root>
  <Dialog.Portal>
    <Dialog.Backdrop />
    <Dialog.Popup />
  </Dialog.Portal>
</Dialog.Root>

// Tabs
import * as Tabs from '@/components/ui/tabs'
<Tabs.Root>
  <Tabs.List>
    <Tabs.Tab />
  </Tabs.List>
  <Tabs.Panel />
</Tabs.Root>

// Select
import * as Select from '@/components/ui/select'
<Select.Root>
  <Select.Trigger />
  <Select.Portal>
    <Select.Popup>
      <Select.Item />
    </Select.Popup>
  </Select.Portal>
</Select.Root>

// Menu
import * as Menu from '@/components/ui/menu'
<Menu.Root>
  <Menu.Trigger />
  <Menu.Portal>
    <Menu.Popup>
      <Menu.Item />
    </Menu.Popup>
  </Menu.Portal>
</Menu.Root>
```

---

## TypeScript

```tsx
// ✅ Estender ComponentProps + VariantProps
export interface ButtonProps
  extends ComponentProps<'button'>,
    VariantProps<typeof buttonVariants> {}

// ✅ import type para tipos puros
import type { ComponentProps } from 'react'
import type { VariantProps } from 'tailwind-variants'

// ❌ Nunca React.FC
// ❌ Nunca any
// ❌ Nunca forwardRef (React 19 não precisa)
```

---

## Padrões Obrigatórios

```tsx
// twMerge sempre
className={twMerge('classes-base', className)}

// data-slot sempre no elemento raiz
<div data-slot="card">

// Estados via data-attributes
data-disabled={disabled ? '' : undefined}
className="data-[disabled]:opacity-50 data-[selected]:bg-primary"

// Focus visible em todos interativos
'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

// Ícones com tamanho explícito
<Check className="size-4" />

// Ícones via variante
'[&_svg]:size-3.5'

// aria-label obrigatório em botões de ícone
<button aria-label="Fechar"><X className="size-4" /></button>

// props spread no final
{...props}
```

---

## Checklist (verificar antes de finalizar)

- [ ] Arquivo lowercase com hífens
- [ ] Named export (sem default)
- [ ] Sem barrel file criado
- [ ] `ComponentProps<'elemento'>` + `VariantProps`
- [ ] Variantes com `tv()`, classes com `twMerge()`
- [ ] `data-slot` no elemento raiz
- [ ] Estados via `data-[state]:`
- [ ] Cores do tema — sem hardcoded
- [ ] Focus visible em interativos
- [ ] `aria-label` em botões de ícone
- [ ] `{...props}` no final
