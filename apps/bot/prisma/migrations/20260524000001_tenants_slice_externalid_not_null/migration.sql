-- Backfill: assign externalId to any Tenant row that doesn't have one
UPDATE "Tenant"
SET "externalId" = 'IQ-' || LPAD(NEXTVAL('tenant_external_seq')::text, 3, '0')
WHERE "externalId" IS NULL;

-- Enforce NOT NULL now that all rows have a value
ALTER TABLE "Tenant" ALTER COLUMN "externalId" SET NOT NULL;
