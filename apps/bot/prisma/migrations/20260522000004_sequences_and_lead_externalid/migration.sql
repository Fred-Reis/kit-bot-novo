-- Migration M4: PostgreSQL sequences + Lead.externalId column + backfill
-- Run with bot traffic paused to avoid sequence drift during backfill.

-- 1. Add Lead.externalId (nullable, unique) — idempotent
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Lead_externalId_key" ON "Lead"("externalId");

-- 2. Create sequences
CREATE SEQUENCE IF NOT EXISTS property_external_seq START 1;
CREATE SEQUENCE IF NOT EXISTS tenant_external_seq START 1;
CREATE SEQUENCE IF NOT EXISTS lead_external_seq START 1;
CREATE SEQUENCE IF NOT EXISTS contract_external_seq START 1;

-- 3. Align sequences with current max values
-- Uses DO blocks to skip setval when no rows exist (setval(seq, 0) is invalid).

-- property: IM-XXXX
DO $$
DECLARE v INTEGER;
BEGIN
  SELECT MAX(CAST(SUBSTRING("externalId" FROM 'IM-(\d+)') AS INTEGER))
  INTO v FROM "Property" WHERE "externalId" ~ '^IM-\d+$';
  IF v IS NOT NULL THEN PERFORM setval('property_external_seq', v); END IF;
END $$;

-- tenant: IQ-XXX
DO $$
DECLARE v INTEGER;
BEGIN
  SELECT MAX(CAST(SUBSTRING("externalId" FROM 'IQ-(\d+)') AS INTEGER))
  INTO v FROM "Tenant" WHERE "externalId" IS NOT NULL AND "externalId" ~ '^IQ-\d+$';
  IF v IS NOT NULL THEN PERFORM setval('tenant_external_seq', v); END IF;
END $$;

-- lead: no externalId yet — set sequence to row count so nextval() gives count+1
DO $$
DECLARE v BIGINT;
BEGIN
  SELECT COUNT(*) INTO v FROM "Lead";
  IF v > 0 THEN PERFORM setval('lead_external_seq', v); END IF;
END $$;

-- contract: CT-YYYY-XXXX
DO $$
DECLARE v INTEGER;
BEGIN
  SELECT MAX(CAST(SUBSTRING("code" FROM 'CT-\d{4}-(\d+)') AS INTEGER))
  INTO v FROM "Contract" WHERE "code" ~ '^CT-\d{4}-\d+$';
  IF v IS NOT NULL THEN PERFORM setval('contract_external_seq', v); END IF;
END $$;

-- 4. Backfill Lead.externalId via ROW_NUMBER ordered by createdAt
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC) AS rn
  FROM "Lead"
)
UPDATE "Lead"
SET "externalId" = 'LD-' || LPAD(ranked.rn::TEXT, 4, '0')
FROM ranked
WHERE "Lead".id = ranked.id;

-- 5. Backfill Tenant.externalId where NULL
-- Offsets new numbers above the current max to avoid collisions.
DO $$
DECLARE max_existing INTEGER;
BEGIN
  SELECT COALESCE(
    MAX(CAST(SUBSTRING("externalId" FROM 'IQ-(\d+)') AS INTEGER)),
    0
  ) INTO max_existing FROM "Tenant" WHERE "externalId" IS NOT NULL AND "externalId" ~ '^IQ-\d+$';

  UPDATE "Tenant" t
  SET "externalId" = 'IQ-' || LPAD((max_existing + ranked.rn)::TEXT, 3, '0')
  FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC) AS rn
    FROM "Tenant"
    WHERE "externalId" IS NULL
  ) ranked
  WHERE t.id = ranked.id;
END $$;
