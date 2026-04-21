import { supabase } from './supabase';

export async function uploadPropertyMedia(
  propertyId: string,
  file: File,
): Promise<{ url: string; path: string }> {
  const ext = file.name.split('.').pop() ?? 'bin';
  const path = `${propertyId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage.from('properties').upload(path, file, {
    contentType: file.type,
    upsert: false,
  });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from('properties').getPublicUrl(path);
  return { url: data.publicUrl, path };
}

export async function deletePropertyMediaFile(path: string): Promise<void> {
  const { error } = await supabase.storage.from('properties').remove([path]);
  if (error) throw new Error(`Storage delete failed: ${error.message}`);
}
