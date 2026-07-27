import * as Sentry from '@sentry/bun';
import { config } from '@/config';

// Note: no @sentry/profiling-node — it's a native addon and isn't supported on Bun.
if (config.SENTRY_DSN) {
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'production',
    tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
    enableLogs: true,
  });
}
