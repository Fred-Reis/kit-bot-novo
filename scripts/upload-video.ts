import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const VIDEO_PATH = '../media/properties/KIT-01/kitnet-retiro-video.mp4';
const STORAGE_PATH = 'KIT-01/videos/kitnet-retiro-video.mp4';
const BUCKET = 'properties';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  // 1. Upload video
  console.log('Uploading video...');
  const file = readFileSync(new URL(VIDEO_PATH, import.meta.url));

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(STORAGE_PATH, file, {
      contentType: 'video/mp4',
      upsert: true,
    });

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  // 3. Get public URL
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(STORAGE_PATH);
  const publicUrl = data.publicUrl;
  console.log(`Public URL: ${publicUrl}`);

  // 4. Find KIT-01 property id
  const { data: property, error: propError } = await supabase
    .from('Property')
    .select('id')
    .eq('externalId', 'KIT-01')
    .single();

  if (propError || !property) throw new Error(`KIT-01 not found: ${propError?.message}`);

  // 5. Insert PropertyMedia record (skip if video already exists)
  const { data: existing } = await supabase
    .from('PropertyMedia')
    .select('id')
    .eq('propertyId', property.id)
    .eq('type', 'video')
    .maybeSingle();

  if (existing) {
    console.log('Video record already exists, skipping insert.');
  } else {
    const { error: mediaError } = await supabase.from('PropertyMedia').insert({
      propertyId: property.id,
      type: 'video',
      url: publicUrl,
      label: 'Vídeo da quitinete',
      order: 1,
    });
    if (mediaError) throw new Error(`PropertyMedia insert failed: ${mediaError.message}`);
  }

  console.log('Done! Video linked to KIT-01.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
