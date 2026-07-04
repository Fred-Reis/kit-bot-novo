import { createClient } from '@supabase/supabase-js';
import { config } from '../src/config';

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

async function main(): Promise<void> {
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) throw new Error(`listBuckets falhou: ${listErr.message}`);

  const exists = (buckets ?? []).some((b) => b.name === 'leads');
  if (!exists) {
    const { error: createErr } = await supabase.storage.createBucket('leads', { public: false });
    if (createErr) throw new Error(`createBucket falhou: ${createErr.message}`);
    console.log('Bucket "leads" criado (privado).');
  } else {
    console.log('Bucket "leads" já existe.');
  }

  const testPath = `healthcheck/${Date.now()}.txt`;
  const { error: upErr } = await supabase.storage
    .from('leads')
    .upload(testPath, Buffer.from('healthcheck'), { contentType: 'text/plain' });
  if (upErr) throw new Error(`upload de teste falhou: ${upErr.message}`);

  try {
    const { data: signed, error: signErr } = await supabase.storage.from('leads').createSignedUrl(testPath, 60);
    if (signErr || !signed) throw new Error(`signed URL falhou: ${signErr?.message}`);
    const res = await fetch(signed.signedUrl);
    if (!res.ok) throw new Error(`signed URL inacessível: HTTP ${res.status}`);
    console.log('Storage saudável ✅ upload + signed URL OK');
  } finally {
    const { error: removeErr } = await supabase.storage.from('leads').remove([testPath]);
    if (removeErr) console.error(`Falha ao remover arquivo de teste: ${removeErr.message}`);
  }
}

main().catch((err) => {
  console.error('FALHA:', err);
  process.exit(1);
});
