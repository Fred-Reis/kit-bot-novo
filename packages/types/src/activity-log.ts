export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export type ActivityLogActorType = 'system' | 'bot' | 'user' | 'owner';

export type ActivityLogSubjectType =
  | 'lead'
  | 'tenant'
  | 'property'
  | 'contract'
  | 'payment'
  | 'template'
  | 'rule_set'
  | 'coordinator'
  | 'owner'
  | 'workspace'
  | 'complaint'
  | 'maintenance_request'
  | 'service_provider';

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
  | 'property_status_changed'
  | 'property_activated'
  | 'property_deactivated'
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
  | 'visit_completed'
  | 'visit_cancelled'
  | 'bot_globally_paused'
  | 'bot_globally_resumed'
  | 'document_reclassified'
  | 'coordinator_created'
  | 'coordinator_updated'
  | 'coordinator_deleted'
  | 'coordinator_linked'
  | 'coordinator_unlinked'
  | 'coordinator_bulk_linked'
  | 'tenant_escalated'
  | 'tenant_emergency'
  | 'tenant_media_forwarded'
  | 'complaint_registered'
  | 'complaint_status_changed'
  | 'maintenance_request_created'
  | 'maintenance_status_changed'
  | 'provider_created'
  | 'provider_updated';

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
