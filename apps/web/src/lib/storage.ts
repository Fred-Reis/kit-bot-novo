import { supabase } from './supabase';
import { adminApi } from './api';

export async function uploadPropertyMedia(
  propertyId: string,
  file: File,
): Promise<{ url: string; path: string }> {
  // Get a signed upload URL from the bot (uses service role, bypasses RLS)
  const { data } = await adminApi.getPropertyMediaSignedUrl(propertyId, {
    fileName: file.name,
    contentType: file.type,
  });

  const { signedUrl, path } = data as { signedUrl: string; path: string; token: string };

  // Upload directly to Supabase Storage using the signed URL
  const res = await fetch(signedUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  });

  if (!res.ok) throw new Error(`Storage upload failed: ${res.status}`);

  // Register the media record in the DB via bot
  const type = file.type.startsWith('video/') ? 'video' : 'photo';
  await adminApi.createPropertyMedia(propertyId, { path, type });

  const { data: urlData } = supabase.storage.from('properties').getPublicUrl(path);
  return { url: urlData.publicUrl, path };
}

export async function deletePropertyMediaFile(path: string): Promise<void> {
  const { error } = await supabase.storage.from('properties').remove([path]);
  if (error) throw new Error(`Storage delete failed: ${error.message}`);
}
