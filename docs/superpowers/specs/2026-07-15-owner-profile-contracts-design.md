# Perfil do proprietário para contratos

> Data: 2026-07-15
> Origem: ROADMAP.md — "Próximas prioridades" #1

## Problema

`Owner` não tem CPF, CNPJ nem endereço. `buildLeadAutoMap` (resolução de variáveis de contrato) só preenche `locador`/`nome_locador` — `{{cpf_locador}}`, `{{endereco_locador}}`, `{{cnpj_locador}}` sempre aparecem como não resolvidas no modal "Aprovar KYC", exigindo preenchimento manual toda vez.

## Escopo

Adicionar CPF, CNPJ (opcional) e endereço ao `Owner`, com CRUD em Config > Workspace, e usar esses dados na resolução automática de variáveis de contrato.

Fora de escopo: auto-fill do modal Aprovar KYC além do que `contract-variables` já faz hoje (esse endpoint já auto-mapeia; só precisa que o map inclua os novos campos — nenhuma mudança de UI no modal é necessária além do que já existe).

## Decisões

- **Nome do locador reusa `Owner.name` existente** — não cria campo `ownerName` separado. Hoje `name` já é usado pelo bot e já mapeado em `nome_locador`; duplicar criaria risco de divergência sem ganho.
- **Endereço como texto único** (`Owner.address: String?`) — não estruturado como `Property` (rua/número/bairro/cidade/UF). Único uso é interpolação em `{{endereco_locador}}`; estruturar adicionaria UI e complexidade sem consumidor que precise dos campos separados.
- **Validação só de formato**, sem dígito verificador — consistente com o padrão já usado em `/admin/workspace/notifications` (regex de phone/email). CPF: 11 dígitos após remover máscara. CNPJ: 14 dígitos após remover máscara, campo opcional.
- **`name` passa a ser editável em Config > Workspace** — hoje não existe endpoint pra isso; `WorkspaceSection` é placeholder hardcoded. O novo endpoint cobre `name` junto com os campos novos.

## Schema

`apps/bot/prisma/schema.prisma` — `Owner` ganha:

```prisma
model Owner {
  ...
  cpf     String?
  cnpj    String?
  address String?
  ...
}
```

Migration `apps/bot/prisma/migrations/20260715000001_owner_profile_fields/migration.sql`:

```sql
ALTER TABLE "Owner" ADD COLUMN "cpf" TEXT;
ALTER TABLE "Owner" ADD COLUMN "cnpj" TEXT;
ALTER TABLE "Owner" ADD COLUMN "address" TEXT;
```

Todos nullable — não quebra rows existentes, segue o padrão de `notificationPhone`/`notificationEmail`.

## Backend (`apps/bot`)

### `PATCH /admin/workspace/profile`

Novo endpoint em `src/routes/admin.ts`, seguindo o padrão de `PATCH /admin/workspace/notifications` (linhas 175-213):

- Body: `{ name?: string; cpf?: string; cnpj?: string; address?: string }`
- Valida CPF (11 dígitos após strip de não-dígitos) e CNPJ (14 dígitos após strip, só se enviado) — 400 se formato inválido
- `prisma.owner.findFirst()` (single-tenant, mesmo padrão dos outros endpoints de workspace)
- `prisma.owner.update(...)` com update parcial — só campos enviados; string vazia vira `null`
- Log activity (`logActivity`) igual aos outros PATCH de workspace
- Retorna valores atualizados, fallback pros valores anteriores nos campos não enviados

### `buildLeadAutoMap` (linhas 30-99)

Estende o tipo de `property.owner` para incluir `cpf`, `cnpj`, `address`. No retorno, adiciona (só quando o campo existir no Owner, mesmo padrão condicional já usado em `cpf_locatario`/`rg_locatario`):

```ts
...(property.owner?.cpf ? { cpf_locador: property.owner.cpf } : {}),
...(property.owner?.cnpj ? { cnpj_locador: property.owner.cnpj } : {}),
...(property.owner?.address ? { endereco_locador: property.owner.address } : {}),
```

`nome_locador`/`locador` continuam vindo de `property.owner.name` — sem mudança.

### `GET /admin/leads/:id/contract-variables`

Sem mudança de código. `unresolved` naturalmente reflete os novos placeholders resolvidos, já que consome `buildLeadAutoMap`.

## Frontend (`apps/web`)

### `src/lib/queries.ts`

`OwnerSettings` ganha `name`, `cpf`, `cnpj`, `address`. `fetchOwner` inclui essas colunas no `.select(...)`.

### `src/lib/api.ts`

```ts
updateOwnerProfile: (data: { name?: string; cpf?: string; cnpj?: string; address?: string }) =>
  botApi.patch('/admin/workspace/profile', data),
```

### `src/routes/_dashboard/config/index.tsx`

`WorkspaceSection` (hoje placeholder hardcoded, linhas 72-83) vira form real, seguindo o padrão de `NotificationContactCard` (linhas 169-226): `useState` por campo, seed via `useEffect` quando `owner` carrega, `handleSave` chama `updateOwnerProfile`, invalida `['owner']`, toast de sucesso/erro.

Campos: Nome, CPF, Endereço, CNPJ (marcado opcional na label).

## Types (`packages/types`)

`src/property.ts` — `Owner` ganha `cpf: string | null`, `cnpj: string | null`, `address: string | null`, e `botEnabled: boolean` (já existe no schema e em `OwnerSettings`, mas faltava no type compartilhado — corrigido junto pra não deixar o type mentindo).

## Testes / verificação

- Migration aplica limpo em dev (`bunx prisma migrate dev`)
- `PATCH /admin/workspace/profile`: aceita CPF/CNPJ com e sem máscara, rejeita formato inválido (400), aceita `address` livre, string vazia limpa o campo (`null`)
- `buildLeadAutoMap`: com Owner completo, `{{cpf_locador}}`/`{{cnpj_locador}}`/`{{endereco_locador}}` resolvem; com Owner sem CNPJ, `{{cnpj_locador}}` continua em `unresolved`
- `GET /admin/leads/:id/contract-variables`: antes preenchido, `cpf_locador`/`endereco_locador` não aparecem mais em `unresolved`
- Web: form em Config > Workspace salva e persiste após reload; validação de erro exibida em toast quando backend rejeita
