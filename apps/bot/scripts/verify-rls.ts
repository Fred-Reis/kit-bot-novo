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
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: ownerId }),
    ]);

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
