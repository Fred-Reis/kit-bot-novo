import { createClient } from '@supabase/supabase-js';
import { config } from '@/config';

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

const UPLOAD_TIMEOUT_MS = 15_000;

// supabase-js's storage upload doesn't take an AbortSignal, so this can't
// truly cancel a stalled request — but it does bound how long callers wait.
// Without this, buffer.ts's pendingUploads guard (see buffer.ts) would
// re-arm the debounce forever if a Storage request never settles, silently
// stalling that lead's messages instead of hitting the existing
// catch/recordMediaFailure path within a bounded time.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

export async function uploadLeadDocument(
  chatId: string,
  base64Content: string,
  mimeType: string,
): Promise<string> {
  const ext = mimeType.split('/')[1] ?? 'bin';
  const timestamp = Date.now();
  const phone = chatId.split('@')[0];
  const storagePath = `leads/${phone}/${timestamp}.${ext}`;

  const buffer = Buffer.from(base64Content, 'base64');

  const { error } = await withTimeout(
    supabase.storage.from('leads').upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false,
    }),
    UPLOAD_TIMEOUT_MS,
    'Supabase Storage upload',
  );

  if (error) {
    throw new Error(`Supabase Storage upload failed: ${error.message}`);
  }

  return storagePath;
}

export async function createLeadDocumentUrl(storagePath: string, expiresIn = 3_600): Promise<string> {
  const { data, error } = await supabase.storage.from('leads').createSignedUrl(storagePath, expiresIn);
  if (error || !data) throw new Error(`Supabase signed URL failed: ${error?.message}`);
  return data.signedUrl;
}
