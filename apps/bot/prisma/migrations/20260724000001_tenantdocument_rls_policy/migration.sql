-- TenantDocument was created (20260718000001_add_tenant_documents) after the
-- RLS policies migration (20260717000001_rls_policies) already ran, so it
-- never got a select_own_rows policy like its sibling LeadDocument. RLS was
-- separately enabled on this table (see incident: tenant documents fetched
-- via supabase-js/PostgREST returned an empty list even though the rows
-- existed — RLS-enabled + zero policies defaults to deny-all for anyone
-- other than the table owner). This brings it in line with LeadDocument.
CREATE POLICY "select_own_rows" ON "TenantDocument"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");
