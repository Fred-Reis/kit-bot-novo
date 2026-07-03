import { createClient } from '@supabase/supabase-js';
import { config } from '@/config';

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

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

  const { error } = await supabase.storage.from('leads').upload(storagePath, buffer, {
    contentType: mimeType,
    upsert: false,
  });

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
