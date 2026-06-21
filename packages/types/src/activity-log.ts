export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export type ActivityLogActorType = 'system' | 'bot' | 'user';

export type ActivityLogSubjectType =
  | 'lead'
  | 'tenant'
  | 'property'
  | 'contract'
  | 'payment'
  | 'template'
  | 'rule_set'
  | 'owner';

export type ActivityLogAction =
  | 'lead_created'
  | 'lead_reactivated'
  | 'lead_stage_changed'
  | 'lead_source_corrected'
  | 'lead_archived'
  | 'lead_unarchived'
  | 'bot_paused'
  | 'bot_resumed'
  | 'kyc_approved'
  | 'kyc_rejected'
  | 'contract_created'
  | 'contract_signed'
  | 'contract_cancelled'
  | 'payment_recorded'
  | 'payment_confirmed'
  | 'payment_marked_overdue'
  | 'property_created'
  | 'property_published'
  | 'property_archived'
  | 'tenant_created'
  | 'tenant_status_changed'
  | 'template_created'
  | 'template_published'
  | 'template_unpublished'
  | 'rule_set_created'
  | 'rule_set_linked'
  | 'rule_set_unlinked'
  | 'owner_updated'
  | 'visit_scheduled'
  | 'visit_completed';

export interface LogActivityParams {
  ownerId: string;
  actorType: ActivityLogActorType;
  actorId?: string;
  actorLabel: string;
  action: ActivityLogAction;
  subjectType: ActivityLogSubjectType;
  subjectId: string;
  subject?: string;
  metadata?: Record<string, JsonValue>;
}

export interface ActivityLog {
  id: string;
  ownerId: string;
  actorType: ActivityLogActorType;
  actorId: string | null;
  actorLabel: string;
  action: ActivityLogAction;
  subjectType: ActivityLogSubjectType;
  subjectId: string;
  subject: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}
