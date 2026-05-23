import type { LogActivityParams } from '@kit-manager/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function logActivity(
  supabase: SupabaseClient,
  params: LogActivityParams,
): Promise<void> {
  const { error } = await supabase.from('ActivityLog').insert({
    ownerId: params.ownerId,
    actorType: params.actorType,
    actorId: params.actorId ?? null,
    actorLabel: params.actorLabel,
    action: params.action,
    subjectType: params.subjectType,
    subjectId: params.subjectId,
    subject: params.subject ?? null,
    metadata: params.metadata ?? {},
  });
  if (error) throw error;
}
