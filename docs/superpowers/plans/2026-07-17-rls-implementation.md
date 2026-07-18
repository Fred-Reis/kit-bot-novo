# RLS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create RLS SELECT policies (kept inactive) for every `ownerId`-scoped table, verify they work correctly against the real database, and document the result — without changing runtime behavior yet.

**Architecture:** One hand-written SQL migration (Prisma can't model `CREATE POLICY`, so it's a raw-SQL migration file) adds a SELECT policy per table, scoped to `auth.uid()::text = "ownerId"` (or a join for tables without a direct `ownerId`). No `ENABLE ROW LEVEL SECURITY` is issued — policies exist but are inert until a table has RLS turned on, so applying this migration to the live database is a no-op in practice. A standalone verification script then opens one transaction, temporarily enables RLS on all target tables, exercises SELECT as the `authenticated` role and INSERT as the bot's real role, and rolls everything back — so verification never mutates or restricts real data.

**Tech Stack:** Bun, Prisma (raw-SQL migration), `pg` (already a dependency via `apps/bot/src/db/client.ts`'s `Pool`), Postgres RLS/`SET LOCAL ROLE`.

## Global Constraints

- Use **bun**, not npm/yarn (project-wide rule).
- No Python (project-wide rule).
- No code changes to bot's request-handling logic — Prisma connects via `DATABASE_URL` as table owner (`postgres` role via `pg` `Pool` in `apps/bot/src/db/client.ts`), which bypasses RLS regardless of policies. `SUPABASE_SERVICE_KEY` is Storage-only (`apps/bot/src/services/storage.ts`), unrelated to DB RLS.
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` is explicitly **out of scope** for this plan — do not add it to the migration. Activation is a future, separate, gated migration.
- Owner UUID `50ebce4b-e386-41aa-8b9f-bc2d8bb5996e` (confirmed identical between `Owner.id` in Postgres and the Supabase Auth user for `fred.rlopes@gmail.com` — no realignment migration needed, see spec) is documented in the ADR (Task 3) as a factual finding. It must **not** be hardcoded into any script — Task 2's verification script looks the owner up dynamically (`SELECT id FROM "Owner" LIMIT 1`), so it keeps working unmodified if the owner ever changes.
- Table list (from `apps/bot/prisma/schema.prisma`), direct `ownerId`: `Property`, `PropertyMedia`, `Lead`, `LeadDocument`, `LeadResident`, `Tenant`, `Payment`, `ActivityLog`, `Event`, `Conversation`, `RuleSet`, `ContractTemplate`, `Contract`. Join-based (no direct `ownerId`): `RuleSetPolicy` (via `RuleSet`), `PropertyRuleSet` (via `Property`). Self-only: `Owner`.
- Spec: `docs/superpowers/specs/2026-07-17-rls-implementation-design.md`. ADR: `docs/adrs/001-rls-strategy.md`.

---

### Task 1: RLS policies migration

**Files:**
- Create: `apps/bot/prisma/migrations/20260717000001_rls_policies/migration.sql`
- Modify: none (`schema.prisma` is unchanged — Prisma has no concept of `CREATE POLICY`)

**Interfaces:**
- Consumes: nothing from earlier tasks (first task).
- Produces: 16 Postgres policies named `select_own_rows` (15 tables) / `select_self` (`Owner`), queryable via `SELECT * FROM pg_policies WHERE schemaname = 'public'`. Task 2's verification script assumes these exact policy predicates exist and that `Owner.id` values equal the intended `auth.uid()` values.

- [ ] **Step 1: Create the empty migration skeleton**

Run (from `apps/bot/`):
```bash
bunx prisma migrate dev --create-only --name rls_policies
```
Expected: Prisma reports no schema drift (nothing changed in `schema.prisma`) and creates an empty `apps/bot/prisma/migrations/<timestamp>_rls_policies/migration.sql`. Rename the generated folder to `20260717000001_rls_policies` if the timestamp differs, so it sorts correctly among the existing migrations.

- [ ] **Step 2: Write the policy SQL**

Replace the contents of `apps/bot/prisma/migrations/20260717000001_rls_policies/migration.sql` with:

```sql
-- Direct ownerId tables
CREATE POLICY "select_own_rows" ON "Property"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "select_own_rows" ON "PropertyMedia"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "select_own_rows" ON "Lead"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "select_own_rows" ON "LeadDocument"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "select_own_rows" ON "LeadResident"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "select_own_rows" ON "Tenant"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "select_own_rows" ON "Payment"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "select_own_rows" ON "ActivityLog"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "select_own_rows" ON "Event"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "select_own_rows" ON "Conversation"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "select_own_rows" ON "RuleSet"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "select_own_rows" ON "ContractTemplate"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "select_own_rows" ON "Contract"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

-- Join-based tables (no direct ownerId column)
CREATE POLICY "select_own_rows" ON "RuleSetPolicy"
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "RuleSet" r WHERE r.id = "ruleSetId" AND auth.uid()::text = r."ownerId"
  ));

CREATE POLICY "select_own_rows" ON "PropertyRuleSet"
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "Property" p WHERE p.id = "propertyId" AND auth.uid()::text = p."ownerId"
  ));

-- Owner: self only
CREATE POLICY "select_self" ON "Owner"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = id);
```

No `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` anywhere in this file — see Global Constraints.

- [ ] **Step 3: Apply the migration**

Run (from `apps/bot/`, with `.env` loaded):
```bash
set -a; source .env; set +a
bunx prisma migrate dev
```
Expected: Prisma detects the already-created `20260717000001_rls_policies` migration is unapplied and applies it. Output ends with `Your database is now in sync with your schema.` No errors — `CREATE POLICY` on a table without RLS enabled is a normal DDL statement.

- [ ] **Step 4: Verify policies exist and RLS is still off**

Run (from `apps/bot/`, with `.env` loaded):
```bash
set -a; source .env; set +a
bun -e '
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const { rows: policies } = await pool.query(`SELECT tablename, policyname FROM pg_policies WHERE schemaname = "public" ORDER BY tablename`);
console.log(`Policies created: ${policies.length}`);
console.table(policies);
const { rows: rls } = await pool.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY($1)`, [["Property","Owner"]]);
console.table(rls);
await pool.end();
'
```
Expected: `Policies created: 16` (15 `select_own_rows` + 1 `select_self`), and `relrowsecurity` is `false` for both sampled tables (RLS not yet enabled — policies are inert, matching the plan).

- [ ] **Step 5: Commit**

```bash
git add apps/bot/prisma/migrations/20260717000001_rls_policies
git commit -m "feat(db): add RLS SELECT policies for owner-scoped tables (inactive)"
```

---

### Task 2: Verification script — authenticated read + bot write under RLS

**Files:**
- Create: `apps/bot/scripts/verify-rls.ts`

**Interfaces:**
- Consumes: the 16 policies created in Task 1 (via `pg_policies`); the table list from Global Constraints. The owner UUID is not a constant — the script fetches it at runtime with `SELECT id FROM "Owner" LIMIT 1`.
- Produces: a standalone, rerunnable CLI check (`bun run apps/bot/scripts/verify-rls.ts`) that exits `0` on all-pass, `1` otherwise. Reusable later, unmodified, to re-verify after the future RLS-activation migration.

- [ ] **Step 1: Write the verification script**

Create `apps/bot/scripts/verify-rls.ts`:

```typescript
import { Pool } from 'pg';

const TABLES = [
  'Property',
  'PropertyMedia',
  'Lead',
  'LeadDocument',
  'LeadResident',
  'Tenant',
  'Payment',
  'ActivityLog',
  'Event',
  'Conversation',
  'RuleSet',
  'ContractTemplate',
  'Contract',
  'RuleSetPolicy',
  'PropertyRuleSet',
  'Owner',
];

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  let allPass = true;

  try {
    await client.query('BEGIN');

    const { rows: ownerRows } = await client.query('SELECT id FROM "Owner" LIMIT 1');
    if (ownerRows.length === 0) {
      throw new Error('No Owner row found — cannot verify RLS without at least one owner.');
    }
    const ownerId: string = ownerRows[0].id;

    const baseline: Record<string, number> = {};
    for (const table of TABLES) {
      const { rows } = await client.query(`SELECT count(*)::int AS count FROM "${table}"`);
      baseline[table] = rows[0].count;
    }

    for (const table of TABLES) {
      await client.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    }

    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SET LOCAL request.jwt.claims = '{"sub":"${ownerId}"}'`);

    for (const table of TABLES) {
      const { rows } = await client.query(`SELECT count(*)::int AS count FROM "${table}"`);
      const pass = rows[0].count === baseline[table];
      console.log(
        `${pass ? 'PASS' : 'FAIL'} SELECT ${table} as authenticated: got=${rows[0].count} expected=${baseline[table]}`,
      );
      if (!pass) allPass = false;
    }

    await client.query('RESET ROLE');

    const insertResult = await client.query(
      `INSERT INTO "ActivityLog"
         (id, "ownerId", "actorType", "actorLabel", action, "subjectType", "subjectId")
       VALUES
         (gen_random_uuid(), $1, 'system', 'rls-verify', 'test', 'rls-verify', 'rls-verify')
       RETURNING id`,
      [ownerId],
    );
    const writePass = insertResult.rowCount === 1;
    console.log(`${writePass ? 'PASS' : 'FAIL'} INSERT ActivityLog as bot's own role, RLS enabled`);
    if (!writePass) allPass = false;

    await client.query('ROLLBACK');
    console.log(
      allPass
        ? '\nAll checks passed. Nothing persisted (transaction rolled back).'
        : '\nSome checks FAILED. Nothing persisted (transaction rolled back).',
    );
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Verification errored, rolled back:', err);
    allPass = false;
  } finally {
    client.release();
    await pool.end();
  }

  process.exit(allPass ? 0 : 1);
}

main();
```

- [ ] **Step 2: Run it**

Run (from `apps/bot/`, with `.env` loaded):
```bash
set -a; source .env; set +a
bun run scripts/verify-rls.ts
```
Expected: every line prints `PASS` (16 `SELECT` lines + 1 `INSERT` line), ending with `All checks passed. Nothing persisted (transaction rolled back).` and exit code `0` (check with `echo $?`).

If any `SELECT` line prints `FAIL`, the policy predicate for that table is wrong (compare against Task 1 Step 2) — fix the migration SQL, apply a corrective migration, and rerun this script before continuing. Do not proceed to Task 3 with a failing table.

- [ ] **Step 3: Confirm the real table state is untouched**

Run (from `apps/bot/`, with `.env` loaded):
```bash
set -a; source .env; set +a
bun -e '
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const { rows } = await pool.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname = "Property"`);
console.table(rows);
await pool.end();
'
```
Expected: `relrowsecurity` is still `false` — the script's `ROLLBACK` reverted the temporary `ENABLE ROW LEVEL SECURITY` calls, so production behavior is unchanged after verification.

- [ ] **Step 4: Commit**

```bash
git add apps/bot/scripts/verify-rls.ts
git commit -m "test(db): add RLS verification script (authenticated read, bot write)"
```

---

### Task 3: Update ADR with findings

**Files:**
- Modify: `docs/adrs/001-rls-strategy.md`

**Interfaces:**
- Consumes: the verified policy list from Task 1/2 and the `Owner.id` alignment finding from the spec.
- Produces: nothing consumed by later tasks — documentation only.

- [ ] **Step 1: Update status line**

In `docs/adrs/001-rls-strategy.md`, replace:
```markdown
**Status:** Documentado — implementação SQL pendente (f2b)
```
with:
```markdown
**Status:** Policies implementadas e verificadas (`20260717000001_rls_policies`) — desativadas até ativação em produção
```

- [ ] **Step 2: Add `LeadResident` to the policy table**

In the "Tabelas com `ownerId` direto" table, add a row after `Lead`:
```markdown
| `LeadResident` | `auth.uid()::text = "ownerId"` |
```

- [ ] **Step 3: Add a note about the `Owner.id`/`auth.uid()` alignment**

After the "## Decisão" section's closing paragraph (`O bot usa \`service_role\` que bypassa RLS, então nenhuma alteração é necessária no código do bot.`), add:

```markdown
**Nota (2026-07-17):** a policy `auth.uid()::text = "ownerId"` só funciona porque `Owner.id` já é idêntico ao `auth.users.id` do Supabase Auth correspondente (verificado em produção: `50ebce4b-e386-41aa-8b9f-bc2d8bb5996e` bate nos dois lados). Isso não é garantido pelo código de criação de Owner (`apps/bot/prisma/seed.ts` gera `Owner.id` via `@default(uuid())`, independente de qualquer auth UUID) — é o estado atual, não um invariante garantido. Ao criar owners futuros (fase 5, multi-tenant), o fluxo de signup precisa setar `Owner.id` = `auth.uid()` explicitamente, ou as policies deixam de bater silenciosamente.
```

- [ ] **Step 4: Commit**

```bash
git add docs/adrs/001-rls-strategy.md
git commit -m "docs: update RLS ADR with implementation status and Owner.id finding"
```

---

### Task 4: Update ROADMAP checklist

**Files:**
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing — documentation only.

- [ ] **Step 1: Update F0.3 checklist**

In `ROADMAP.md`, find (this is the committed baseline this branch was cut from — a doc-sync gap where the checkbox/path/date were never updated after the ADR was actually written on 2026-06-16):
```markdown
### F0.3 — RLS readiness
- [ ] Documentar policies necessárias em `adrs/001-rls-strategy.md`
- [ ] Implementar policies por `ownerId` (mas manter desativadas até produção)
- [ ] Testar leitura como `authenticated` e escrita como `service_role`
- [ ] **Por quê:** dever-de-casa antes de subir produção real.
```
Replace with:
```markdown
### F0.3 — RLS readiness
- [x] Documentar policies necessárias em `docs/adrs/001-rls-strategy.md` (2026-06-16)
- [x] Implementar policies por `ownerId` (mas manter desativadas até produção) (2026-07-17)
- [x] Testar leitura como `authenticated` e escrita como bot/Prisma (2026-07-17)
- [ ] **Ativar RLS** (`ENABLE ROW LEVEL SECURITY`) — migration separada, antes de operar com dados reais de terceiros
- [ ] **Por quê:** dever-de-casa antes de subir produção real.
```

- [ ] **Step 2: Update the "RLS reativar" line in the launch checklist**

Find (around line 322):
```markdown
- [ ] **RLS reativar** — policies documentadas em `docs/adrs/001-rls-strategy.md`; ativar antes de prod
```
Replace with:
```markdown
- [ ] **RLS reativar** — policies implementadas e verificadas em `docs/adrs/001-rls-strategy.md`; falta só `ENABLE ROW LEVEL SECURITY` antes de prod com dados de terceiros
```

- [ ] **Step 3: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: update roadmap F0.3 — RLS policies implemented and verified"
```

---

## Not in this plan (deliberately)

- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` for any table — a short follow-up migration + PR, run only when Fred authorizes production with real third-party data.
- Any change to `apps/web` or `apps/bot` application code — confirmed unnecessary (bot bypasses RLS as table owner; web's `supabase-js` calls are unaffected until RLS is actually enabled).
