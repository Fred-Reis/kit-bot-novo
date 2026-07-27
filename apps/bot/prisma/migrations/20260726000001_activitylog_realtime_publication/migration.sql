-- Enable Supabase Realtime (postgres_changes) for ActivityLog, used by the
-- admin panel's in-app notification badge (F0.4).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'ActivityLog'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE "ActivityLog";
  END IF;
END $$;
