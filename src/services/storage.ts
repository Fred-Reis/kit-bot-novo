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
  const path = `leads/${phone}/${timestamp}.${ext}`;

  const buffer = Buffer.from(base64Content, 'base64');

  const { error } = await supabase.storage.from('leads').upload(path, buffer, {
    contentType: mimeType,
    upsert: false,
  });

  if (error) {
    throw new Error(`Supabase Storage upload failed: ${error.message}`);
  }

  const { data } = supabase.storage.from('leads').getPublicUrl(path);
  return data.publicUrl;
}
