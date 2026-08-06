import { createClient } from '@supabase/supabase-js';
import { addUtcSuffixDeep } from './supabase-timestamp-fix';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// See supabase-timestamp-fix.ts — PostgREST returns naive (no-timezone)
// timestamp strings, which `new Date(...)` misparses as local time instead
// of UTC. Intercepting the raw REST response here fixes every read through
// this client at the source, instead of requiring every call site across the
// app to remember to normalize dates themselves.
async function fetchWithUtcTimestamps(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);

  const url = input instanceof Request ? input.url : String(input);
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || !url.includes('/rest/v1/') || !contentType.includes('application/json')) {
    return response;
  }

  let body: unknown;
  try {
    // Clone before reading — if parsing fails, the original response's body
    // must still be intact for the caller (supabase-js) to read itself.
    body = await response.clone().json();
  } catch {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(JSON.stringify(addUtcSuffixDeep(body)), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithUtcTimestamps },
});
